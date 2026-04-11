import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { searchJournalCatalog } from "../../../src/catalog.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "search_journals",
		label: "Search Journals",
		description: "Search the local journal catalog by topic, quartile, APC, open-access preference, and review speed.",
		parameters: Type.Object({
			query: Type.String({ description: "Paper topic, abstract, or search intent." }),
			quartile: Type.Optional(Type.String({ description: "Optional quartile filter such as Q1." })),
			openAccessOnly: Type.Optional(
				Type.Boolean({ description: "Whether only open-access journals should be returned." })
			),
			maxApcUsd: Type.Optional(Type.Number({ description: "Maximum APC budget in USD." })),
			maxTurnaroundDays: Type.Optional(Type.Number({ description: "Maximum acceptable review turnaround in days." })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of journal candidates to return." }))
		}),
		async execute(_toolCallId, params) {
			const matches = searchJournalCatalog(params);
			if (matches.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No journals matched the current query in the local demo catalog. Try a broader topic or relax the filters."
						}
					],
					details: { matches: [] }
				};
			}

			return {
				content: [
					{
						type: "text",
						text: matches
							.map((match, index) => {
								const { journal } = match;
								return [
									`${index + 1}. ${journal.name}`,
									`quartile: ${journal.quartile}`,
									`open_access: ${journal.openAccess ? "yes" : "no"}`,
									`apc_usd: ${journal.apcUsd}`,
									`turnaround_days: ${journal.turnaroundDays}`,
									`scope: ${journal.scope}`,
									`note: ${journal.note}`,
									`matched_keywords: ${match.matchedKeywords.join(", ") || "broad fit"}`
								].join("\n");
							})
							.join("\n\n")
					}
				],
				details: {
					matches: matches.map((match) => ({
						journal: match.journal,
						score: match.score,
						matchedKeywords: match.matchedKeywords
					}))
				}
			};
		}
	});
}
