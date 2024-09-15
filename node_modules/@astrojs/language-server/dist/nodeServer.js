"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("@volar/language-server/node");
const vscode_uri_1 = require("vscode-uri");
const frontmatterHolders_js_1 = require("./core/frontmatterHolders.js");
const languageServerPlugin_js_1 = require("./languageServerPlugin.js");
const connection = (0, node_1.createConnection)();
const server = (0, node_1.createServer)(connection);
let contentIntellisenseEnabled = false;
connection.listen();
connection.onInitialize((params) => {
    const tsdk = params.initializationOptions?.typescript?.tsdk;
    if (!tsdk) {
        throw new Error('The `typescript.tsdk` init option is required. It should point to a directory containing a `typescript.js` or `tsserverlibrary.js` file, such as `node_modules/typescript/lib`.');
    }
    const { typescript, diagnosticMessages } = (0, node_1.loadTsdkByPath)(tsdk, params.locale);
    contentIntellisenseEnabled = params.initializationOptions?.contentIntellisense ?? false;
    let collectionConfigs = [];
    if (contentIntellisenseEnabled) {
        // The vast majority of clients support workspaceFolders, but notably our tests currently don't
        // Ref: https://github.com/volarjs/volar.js/issues/229
        const folders = params.workspaceFolders ?? (params.rootUri ? [{ uri: params.rootUri }] : []) ?? [];
        collectionConfigs = folders.flatMap((folder) => {
            try {
                const folderUri = vscode_uri_1.URI.parse(folder.uri);
                let config = server.fileSystem.readFile(vscode_uri_1.Utils.joinPath(folderUri, '.astro/collections/collections.json'));
                if (!config) {
                    return [];
                }
                // `server.fs.readFile` can theoretically be async, but in practice it's always sync
                const collections = JSON.parse(config);
                return { folder: folderUri, config: collections };
            }
            catch (err) {
                // If the file doesn't exist, we don't really care, but if it's something else, we want to know
                if (err && err.code !== 'ENOENT')
                    console.error(err);
                return [];
            }
        });
    }
    return server.initialize(params, (0, node_1.createTypeScriptProject)(typescript, diagnosticMessages, ({ env, configFileName }) => {
        return {
            languagePlugins: (0, languageServerPlugin_js_1.getLanguagePlugins)(connection, typescript, env, configFileName, collectionConfigs),
            setup() { },
        };
    }), (0, languageServerPlugin_js_1.getLanguageServicePlugins)(connection, typescript, collectionConfigs));
});
connection.onInitialized(() => {
    server.initialized();
    const extensions = [
        'js',
        'cjs',
        'mjs',
        'ts',
        'cts',
        'mts',
        'jsx',
        'tsx',
        'json',
        'astro',
        'vue',
        'svelte',
    ];
    if (contentIntellisenseEnabled) {
        extensions.push(...frontmatterHolders_js_1.SUPPORTED_FRONTMATTER_EXTENSIONS_KEYS);
    }
    server.fileWatcher.watchFiles([`**/*.{${extensions.join(',')}}`]);
});
//# sourceMappingURL=nodeServer.js.map