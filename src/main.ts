import { App, Plugin, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import hljs from 'highlight.js/lib/common';
import { ModelOperations } from "@vscode/vscode-languagedetection";
import * as modelJSON from "../model.json";

// Remember to rename these classes and interfaces!

interface Settings {
	minRelevance: number;
	preferredLanguages: string[];
}

const DEFAULT_SETTINGS: Settings = {
	minRelevance: 0,
	preferredLanguages: []
}

export default class InlineSyntaxHighlight extends Plugin {
	settings: Settings;
	modelOperations: ModelOperations;

	// This does such a poor job on single-line code that it's not even worth
	// adding it as a configurable option.
	async detectByModel(code: string) {
		const langs = await this.modelOperations.runModel(code);
		if (langs.length > 0) return langs[0].languageId;
	}

	detectByHljs(code: string, languageSubset = undefined) {
		const {
			relevance,
			language,
			secondBest
		} = hljs.highlightAuto(code, languageSubset);

		// TODO: make sure considered choices meet minRelevance
		if (!secondBest || !language) return language;

		// TODO: maybe some kind of heuristic where order of preferredLanguages matters
		// and if relevance is identical, take whatever appears first.
		const pref1 = this.settings.preferredLanguages.contains(language);
		const pref2 = secondBest.language && this.settings.preferredLanguages.contains(secondBest.language);

		if (pref1 === pref2) {
			return relevance >= secondBest.relevance ? language : secondBest.language;
		}
		return pref1 ? language : secondBest.language;
	}

	async onload() {
		await this.loadSettings();

		this.modelOperations = new ModelOperations({
			modelJsonLoaderFunc: () => Promise.resolve(modelJSON),
			weightsLoaderFunc: () => this.app.vault.adapter.readBinary(normalizePath(
				this.app.vault.configDir + "/plugins/obsidian-inline-syntax-hl/group1-shard1of1.bin"
			))
		});

		this.registerMarkdownPostProcessor((el, ctx) => {
			// TODO: allow ctx.frontmatter config to force langs
			// TODO: options to omit single words, etc
			const codeblocks = el.findAll("code:not(pre code)");
			codeblocks.forEach(async c => {
				const lang = this.detectByHljs(c.innerText);
				if (lang) {
					c.addClass(`language-${lang}`);
				}
			});
		})

		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: InlineSyntaxHighlight;

	constructor(app: App, plugin: InlineSyntaxHighlight) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		const desc = new DocumentFragment();
		desc.appendText('List of languages, one per line, that will be given preferrence if detected. Consult the')
		desc.appendChild(containerEl.createEl("a", {
			href: "https://highlightjs.readthedocs.io/en/latest/supported-languages.html",
			text: "highlight.js docs"
		}))
		desc.appendText(' for a full list.')
		const list = containerEl.createEl("ul");
		["One language per line", "Use the first value from the 'Aliases' column", "Only core languages (no additional pacakge required)"].forEach(li => {
			list.createEl("li", { text: li });
		});
		desc.appendChild(list);

		new Setting(containerEl)
			.setName('Preferred Languages')
			.setDesc(desc)
			.addTextArea(ta => ta
				.setValue(this.plugin.settings.preferredLanguages.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.preferredLanguages = value
						.split('\n')
						.map(v => v.toLowerCase())
						.filter(v => v.length > 0)
					await this.plugin.saveSettings();
				})
			);
	}
}
