/**
 * Arsenal SSOT Version Definition
 * Reads version directly from package.json so version only ever needs to be updated in one place.
 */
import pkg from "../../package.json";

export const VERSION: string = pkg.version;
