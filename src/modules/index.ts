import { contentModule } from "./content.js";
import { coreModule } from "./core.js";
import { ledgerModule } from "./ledger.js";
import { workspaceModule } from "./workspace.js";
import type { GrokModule } from "./types.js";

export const modules: GrokModule[] = [coreModule, contentModule, ledgerModule, workspaceModule];
