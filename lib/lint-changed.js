"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintChanged = void 0;
const util_1 = __importDefault(require("util"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const micromatch_1 = __importDefault(require("micromatch"));
const p_limit_1 = __importDefault(require("p-limit"));
const await_to_js_1 = __importDefault(require("await-to-js"));
const kleur_1 = require("kleur");
const commander_1 = require("commander");
const limit = p_limit_1.default(8);
const log = (msg) => {
    console.log(kleur_1.blue(`[lint-changed]: ${msg}`));
};
const warn = (msg) => {
    console.warn(kleur_1.yellow(`[lint-changed]: ${msg}`));
};
const error = (msg) => {
    console.error(kleur_1.red(`[lint-changed]: ${msg}`));
};
const filterOutNonExistentFiles = (files) => files.filter((file) => fs_1.default.existsSync(path_1.default.join(process.cwd(), file)));
const run = util_1.default.promisify(child_process_1.exec);
const pkg = JSON.parse(fs_1.default.readFileSync(path_1.default.join(process.cwd(), "package.json"), "utf-8"));
async function runCommand(cmdString) {
    try {
        const { stdout, stderr } = await run(cmdString);
        if (stderr) {
            throw new Error(stderr);
        }
        return stdout.trim();
    }
    catch ({ stdout }) {
        throw new Error(stdout);
    }
}
const git = (args) => runCommand(`git ${args}`);
const getBranch = () => git("rev-parse --abbrev-ref HEAD");
const getLastTag = () => git("describe --tags --abbrev=0 HEAD^");
const getMergeBase = (baseBranch) => git(`merge-base HEAD ${baseBranch}`);
const getChangedFiles = (event) => git(`diff --name-only ${event}`).then((r) => r.split("\n").filter((n) => !!n));
/**
 * Checks for files that have changed since the last tag on the base branch
 */
const checkReleaseBranchForChangedFiles = async () => {
    log("Checking for files that have changed since last tag on release branch");
    const [tagFetchError, lastTag] = await await_to_js_1.default(getLastTag());
    if (tagFetchError) {
        error(`Unable to retrieve last tag:\n${tagFetchError}`);
        process.exit(1);
    }
    const [changedFilesError, changedFilesList] = await await_to_js_1.default(getChangedFiles(`${lastTag}...`));
    if (changedFilesError || changedFilesList === undefined) {
        error(`Unable to get changed files since last tag:\n${changedFilesError}`);
        process.exit(1);
    }
    const existingChangedFiles = filterOutNonExistentFiles(changedFilesList);
    if (existingChangedFiles.length > 0) {
        log(`Files changed since ${lastTag}:\n${kleur_1.dim(existingChangedFiles.join("\n"))}\n`);
    }
    return existingChangedFiles;
};
/**
 * Checks for  files that have changed since baseBranch
 */
const checkFeatureBranchForChangedFiles = async (baseBranch, branch) => {
    log(`Checking for files that have changed on ${branch} since ${baseBranch}`);
    const [mergeBaseError, mergeBase] = await await_to_js_1.default(getMergeBase(baseBranch));
    if (mergeBaseError) {
        error(`Unable to retrieve merge base:\n${mergeBaseError}`);
        process.exit(1);
    }
    const [changedFilesError, changedFilesList] = await await_to_js_1.default(getChangedFiles(`${branch} ${mergeBase}`));
    if (changedFilesError || changedFilesList === undefined) {
        error(`Unable to get changed files since ${baseBranch}:\n${changedFilesError}`);
        process.exit(1);
    }
    const existingChangedFiles = filterOutNonExistentFiles(changedFilesList);
    if (existingChangedFiles.length > 0) {
        log(`Files changed since ${baseBranch}:\n${kleur_1.dim(existingChangedFiles.join("\n"))}\n`);
    }
    return existingChangedFiles;
};
async function lintChanged() {
    const program = new commander_1.Command();
    program
        .option('-B, --base-branch <type>', 'Base Branch')
        .option('-R, --release-branch <type>', 'Release Branch');
    program.parse(process.argv);
    const options = program.opts();
    const lintConfig = pkg["lint-changed"];
    const baseBranch = options.baseBranch || pkg["lint-changed-base-branch"] || "master";
    const releaseBranch = options.releaseBranch || pkg["lint-changed-release-branch"] || "master";
    // Warn if basebranch is not specified
    if (!lintConfig) {
        warn("No `lint-changed-base-branch` found in package.json, falling back to 'master'");
    }
    // Warn if releasebranch is not specified
    if (!lintConfig) {
        warn("No `lint-changed-release-branch` found in package.json, falling back to 'master'");
    }
    // Fail if nothing is configured to run
    if (!lintConfig) {
        warn("No `lint-changed` found in package.json");
        process.exit(1);
    }
    const branch = await getBranch();
    // Determine changed files based on branch
    let changedFiles = branch === releaseBranch
        ? await checkReleaseBranchForChangedFiles()
        : await checkFeatureBranchForChangedFiles(baseBranch, branch);
    // Exit early if no files have changed
    if (changedFiles.length === 0) {
        log("No files changed, skipping linting");
        return;
    }
    const globAndCommands = Object.entries(lintConfig)
        .map(([glob, cmds]) => [glob, Array.isArray(cmds) ? cmds : [cmds]]);
    const results = await Promise.all(globAndCommands.map(async ([glob, commands]) => {
        const files = micromatch_1.default(changedFiles, glob, {
            dot: true,
            matchBase: !glob.includes("/"),
        });
        return await Promise.all(files.map((file) => limit(async () => {
            // Stop running commands for current file on first command that fails
            try {
                for (const command of commands) {
                    const o = await runCommand(`${command} ${file}`);
                    console.log(kleur_1.blue(kleur_1.dim(o)));
                }
            }
            catch (e) {
                error(e.message.trimLeft());
                return e;
            }
        })));
    }));
    // In case there were any errors during execution, make sure to exit with error
    if (results.some((command) => command.some((e) => e))) {
        process.exit(1);
    }
}
exports.lintChanged = lintChanged;
