declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"drafts": {
"240106.md": {
	id: "240106.md";
  slug: "240106";
  body: string;
  collection: "drafts";
  data: any
} & { render(): Render[".md"] };
"240708.md": {
	id: "240708.md";
  slug: "240708";
  body: string;
  collection: "drafts";
  data: any
} & { render(): Render[".md"] };
};
"writing": {
"170404.md": {
	id: "170404.md";
  slug: "170404";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"170723.md": {
	id: "170723.md";
  slug: "170723";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"171020.md": {
	id: "171020.md";
  slug: "171020";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"171129.md": {
	id: "171129.md";
  slug: "171129";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"180822.md": {
	id: "180822.md";
  slug: "180822";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"190103.md": {
	id: "190103.md";
  slug: "190103";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"190124.md": {
	id: "190124.md";
  slug: "190124";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"190225.md": {
	id: "190225.md";
  slug: "190225";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220616.md": {
	id: "220616.md";
  slug: "220616";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220708.md": {
	id: "220708.md";
  slug: "220708";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220719.md": {
	id: "220719.md";
  slug: "220719";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220725.md": {
	id: "220725.md";
  slug: "220725";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220815.md": {
	id: "220815.md";
  slug: "220815";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220822.md": {
	id: "220822.md";
  slug: "220822";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220906.md": {
	id: "220906.md";
  slug: "220906";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"220907.md": {
	id: "220907.md";
  slug: "220907";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"221027.md": {
	id: "221027.md";
  slug: "221027";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"221028.md": {
	id: "221028.md";
  slug: "221028";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"221107.md": {
	id: "221107.md";
  slug: "221107";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230330.md": {
	id: "230330.md";
  slug: "230330";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230411.md": {
	id: "230411.md";
  slug: "230411";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230429.md": {
	id: "230429.md";
  slug: "230429";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230705.md": {
	id: "230705.md";
  slug: "230705";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230714.md": {
	id: "230714.md";
  slug: "230714";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230727.md": {
	id: "230727.md";
  slug: "230727";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230811.md": {
	id: "230811.md";
  slug: "230811";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230820.md": {
	id: "230820.md";
  slug: "230820";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230901.md": {
	id: "230901.md";
  slug: "230901";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"230926.md": {
	id: "230926.md";
  slug: "230926";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"231111.md": {
	id: "231111.md";
  slug: "231111";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"231114.md": {
	id: "231114.md";
  slug: "231114";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"231121.md": {
	id: "231121.md";
  slug: "231121";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"231201.md": {
	id: "231201.md";
  slug: "231201";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"231215.md": {
	id: "231215.md";
  slug: "231215";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"240102.md": {
	id: "240102.md";
  slug: "240102";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"240305.md": {
	id: "240305.md";
  slug: "240305";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"240406.md": {
	id: "240406.md";
  slug: "240406";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"240428.md": {
	id: "240428.md";
  slug: "240428";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"240531.md": {
	id: "240531.md";
  slug: "240531";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
"240610.md": {
	id: "240610.md";
  slug: "240610";
  body: string;
  collection: "writing";
  data: InferEntrySchema<"writing">
} & { render(): Render[".md"] };
};

	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = typeof import("../../src/content/config.js");
}
