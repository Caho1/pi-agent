# Output Schema

The extractor returns one object per URL.

## Top-level fields

- `url`: requested URL
- `final_url`: final URL after redirects
- `host`: host of the final URL
- `page_title`: HTML title when available
- `structured_fields`: short fields extracted with rules
- `field_provenance`: source details for the short fields
- `sections`: cleaned content sections for long-form interpretation
- `clean_text`: fallback plain text built from the main content region
- `llm_payload`: merged long-text buckets ready for summarization

## structured_fields

- `name`
- `title`
- `department`
- `institution`
- `email`
- `phone`
- `office`
- `contact_page`
- `image_url`
- `profile_links`

`profile_links` may contain keys such as `orcid`, `google_scholar`, `scopus`, `dblp`, `researchgate`, `linkedin`, or `personal_website`.

## sections

Each section is an object with:

- `heading`
- `category`
- `text`

The extractor maps headings and hinted containers into these categories when possible:

- `bio`
- `education`
- `work`
- `research`
- `achievements`
- `service`
- `teaching`
- `misc`

## llm_payload

This object merges section text by category:

- `bio`
- `education`
- `work`
- `research`
- `achievements`
- `service`
- `teaching`
- `other`

Use these fields instead of raw HTML when asking a model to summarize or classify the page.
