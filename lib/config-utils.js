"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const io = __importStar(require("@actions/io"));
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
const path = __importStar(require("path"));
const util = __importStar(require("./util"));
class ExternalQuery {
    constructor(repository, ref) {
        this.path = '';
        this.repository = repository;
        this.ref = ref;
    }
}
exports.ExternalQuery = ExternalQuery;
// The set of acceptable values for built-in suites from the codeql bundle
const builtinSuites = ['security-extended', 'security-and-quality'];
class Config {
    constructor() {
        this.name = "";
        this.disableDefaultQueries = false;
        this.additionalQueries = [];
        this.externalQueries = [];
        this.additionalSuites = [];
        this.pathsIgnore = [];
        this.paths = [];
    }
    addQuery(queryUses) {
        // The logic for parsing the string is based on what actions does for
        // parsing the 'uses' actions in the workflow file
        queryUses = queryUses.trim();
        if (queryUses === "") {
            throw new Error(getQueryUsesBlank());
        }
        // Check for the local path case before we start trying to parse the repository name
        if (queryUses.startsWith("./")) {
            const localQueryPath = queryUses.slice(2);
            // Resolve the local path against the workspace so that when this is
            // passed to codeql it resolves to exactly the path we expect it to resolve to.
            const workspacePath = util.getRequiredEnvParam('GITHUB_WORKSPACE');
            const absoluteQueryPath = path.join(workspacePath, localQueryPath);
            // Check the file exists
            if (!fs.existsSync(absoluteQueryPath)) {
                throw new Error(getLocalPathDoesNotExist(localQueryPath));
            }
            // Check the local path doesn't jump outside the repo using '..' or symlinks
            if (!(fs.realpathSync(absoluteQueryPath) + path.sep).startsWith(workspacePath + path.sep)) {
                throw new Error(getLocalPathOutsideOfRepository(localQueryPath));
            }
            this.additionalQueries.push(absoluteQueryPath);
            return;
        }
        // Check for one of the builtin suites
        if (queryUses.indexOf('/') === -1 && queryUses.indexOf('@') === -1) {
            const suite = builtinSuites.find((suite) => suite === queryUses);
            if (suite) {
                this.additionalSuites.push(suite);
                return;
            }
            else {
                throw new Error(getQueryUsesIncorrect(queryUses));
            }
        }
        let tok = queryUses.split('@');
        if (tok.length !== 2) {
            throw new Error(getQueryUsesIncorrect(queryUses));
        }
        const ref = tok[1];
        tok = tok[0].split('/');
        // The first token is the owner
        // The second token is the repo
        // The rest is a path, if there is more than one token combine them to form the full path
        if (tok.length < 2) {
            throw new Error(getQueryUsesIncorrect(queryUses));
        }
        if (tok.length > 3) {
            tok = [tok[0], tok[1], tok.slice(2).join('/')];
        }
        // Check none of the parts of the repository name are empty
        if (tok[0].trim() === '' || tok[1].trim() === '') {
            throw new Error(getQueryUsesIncorrect(queryUses));
        }
        let external = new ExternalQuery(tok[0] + '/' + tok[1], ref);
        if (tok.length === 3) {
            external.path = tok[2];
        }
        this.externalQueries.push(external);
    }
}
exports.Config = Config;
function getQueryUsesBlank() {
    return '"uses" value for queries cannot be blank';
}
exports.getQueryUsesBlank = getQueryUsesBlank;
function getQueryUsesIncorrect(queryUses) {
    return '"uses" value for queries must be a built-in suite (' + builtinSuites.join(' or ') +
        '), a relative path, or of the form owner/repo@ref\n' +
        'Found: ' + queryUses;
}
exports.getQueryUsesIncorrect = getQueryUsesIncorrect;
function getLocalPathOutsideOfRepository(localPath) {
    return 'Unable to use queries from local path "' + localPath +
        '" as it is outside of the repository';
}
exports.getLocalPathOutsideOfRepository = getLocalPathOutsideOfRepository;
function getLocalPathDoesNotExist(localPath) {
    return 'Unable to use queries from local path "' + localPath +
        '" as the path does not exist in the repository';
}
exports.getLocalPathDoesNotExist = getLocalPathDoesNotExist;
function getConfigFileOutsideWorkspaceErrorMessage(configFile) {
    return 'The configuration file "' + configFile + '" is outside of the workspace';
}
exports.getConfigFileOutsideWorkspaceErrorMessage = getConfigFileOutsideWorkspaceErrorMessage;
function getConfigFileDoesNotExistErrorMessage(configFile) {
    return 'The configuration file "' + configFile + '" does not exist';
}
exports.getConfigFileDoesNotExistErrorMessage = getConfigFileDoesNotExistErrorMessage;
function initConfig() {
    let configFile = core.getInput('config-file');
    const config = new Config();
    // If no config file was provided create an empty one
    if (configFile === '') {
        core.debug('No configuration file was provided');
        return config;
    }
    // Treat the config file as relative to the workspace
    const workspacePath = util.getRequiredEnvParam('GITHUB_WORKSPACE');
    configFile = path.resolve(workspacePath, configFile);
    // Error if the config file is now outside of the workspace
    if (!(configFile + path.sep).startsWith(workspacePath + path.sep)) {
        throw new Error(getConfigFileOutsideWorkspaceErrorMessage(configFile));
    }
    // Error if the file does not exist
    if (!fs.existsSync(configFile)) {
        throw new Error(getConfigFileDoesNotExistErrorMessage(configFile));
    }
    const parsedYAML = yaml.safeLoad(fs.readFileSync(configFile, 'utf8'));
    if (parsedYAML.name && typeof parsedYAML.name === "string") {
        config.name = parsedYAML.name;
    }
    if (parsedYAML['disable-default-queries'] && typeof parsedYAML['disable-default-queries'] === "boolean") {
        config.disableDefaultQueries = parsedYAML['disable-default-queries'];
    }
    const queries = parsedYAML.queries;
    if (queries && queries instanceof Array) {
        queries.forEach(query => {
            if (typeof query.uses === "string") {
                config.addQuery(query.uses);
            }
        });
    }
    const pathsIgnore = parsedYAML['paths-ignore'];
    if (pathsIgnore && pathsIgnore instanceof Array) {
        pathsIgnore.forEach(path => {
            if (typeof path === "string") {
                config.pathsIgnore.push(path);
            }
        });
    }
    const paths = parsedYAML.paths;
    if (paths && paths instanceof Array) {
        paths.forEach(path => {
            if (typeof path === "string") {
                config.paths.push(path);
            }
        });
    }
    return config;
}
function getConfigFolder() {
    return util.getRequiredEnvParam('RUNNER_WORKSPACE');
}
function getConfigFile() {
    return path.join(getConfigFolder(), 'config');
}
exports.getConfigFile = getConfigFile;
async function saveConfig(config) {
    const configString = JSON.stringify(config);
    await io.mkdirP(getConfigFolder());
    fs.writeFileSync(getConfigFile(), configString, 'utf8');
    core.debug('Saved config:');
    core.debug(configString);
}
async function loadConfig() {
    const configFile = getConfigFile();
    if (fs.existsSync(configFile)) {
        const configString = fs.readFileSync(configFile, 'utf8');
        core.debug('Loaded config:');
        core.debug(configString);
        return JSON.parse(configString);
    }
    else {
        const config = initConfig();
        core.debug('Initialized config:');
        core.debug(JSON.stringify(config));
        await saveConfig(config);
        return config;
    }
}
exports.loadConfig = loadConfig;
//# sourceMappingURL=config-utils.js.map