import { type Connection, type LanguagePlugin, type LanguageServiceEnvironment } from '@volar/language-server/node';
import { URI } from 'vscode-uri';
import { type CollectionConfig } from './core/frontmatterHolders.js';
export declare function getLanguagePlugins(connection: Connection, ts: typeof import('typescript'), serviceEnv: LanguageServiceEnvironment, tsconfig: string | undefined, collectionConfigs: CollectionConfig[]): LanguagePlugin<URI, import("@volar/language-server/node").VirtualCode>[];
export declare function getLanguageServicePlugins(connection: Connection, ts: typeof import('typescript'), collectionConfigs: CollectionConfig[]): import("@volar/language-server/node").LanguageServicePlugin<any>[];
