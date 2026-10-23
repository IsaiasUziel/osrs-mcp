# Third-party content notices

The MIT license in `LICENSE` applies to this project's original code. It does not relicense content retrieved from external services.

## Old School RuneScape Wiki

Quest guidance retrieves text from the [Old School RuneScape Wiki](https://oldschool.runescape.wiki/). The Wiki's default text license is [Creative Commons Attribution-NonCommercial-ShareAlike 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), except where otherwise specified. Consult the [Wiki policies](https://oldschool.runescape.wiki/w/RuneScape:Policies) and the source page for applicable exceptions.

Responses attribute the Old School RuneScape Wiki contributors and include canonical source URLs, page revision links, fetch timestamps, a license link and transformation details. The adapter extracts template fields, excludes comments and nowiki literals, interprets a narrow subset of skill markup, and bounds selected context. Its output is not an unmodified copy of the source page.

Recipients must respect the applicable attribution, non-commercial and ShareAlike conditions when reusing Wiki content. Do not assume that this project's MIT license grants commercial rights to that content or covers media on linked pages. This adapter does not retrieve images or other media.

Committed quest fixtures are synthetic; they are not snapshots or mirrors of Wiki articles. No code from another MCP project has been copied into this implementation.
