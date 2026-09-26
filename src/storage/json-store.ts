import fs from "node:fs/promises";
import path from "node:path";

export class JsonFileStore<T> {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaultValue: T
  ) {}

  async read(): Promise<T> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return structuredClone(this.defaultValue);
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await fs.rename(tmp, this.filePath);
    });
    return this.writeChain;
  }

  async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    let result!: T;
    this.writeChain = this.writeChain.then(async () => {
      const current = await this.read();
      result = await mutator(current);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      await fs.rename(tmp, this.filePath);
    });
    await this.writeChain;
    return result;
  }
}
