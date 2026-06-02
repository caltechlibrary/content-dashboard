

# content-dashboard

LibGuides has a highlevel view of ownserhsip where Caltech Library has specific people responsible for specific pages. This presents challenged when doing content audits or other reviews of our website content deployed through LibGuides. Taking a development at the edges approach, content-dashboard, provides for the user level responsibility for managing content in LibGuides.



### Authors

- Smith, Twilia


### Contributors

- Doiel, R. S.


## Software Requirements

- dataset >= 2.4.1 (provides `datasetd` and `dataset` CLI)
- Deno >= 2.8 (runs the backend proxy service)
- SQLite >= 3.38 (used by datasetd; the `->>` operator is required)

### Software Suggestions

- CMTools >= 0.0.45b
- Pandoc >= 3.9
- GNU Make >= 3.8

## Setup

See [SETUP.md](SETUP.md) for full configuration instructions, including:

- How to configure `content_dashboard.yaml` for your environment
- Creating `htdocs/dev-config.js` for local development
- Running datasetd and the Deno proxy
- Apache reverse proxy rules for production

## Related resources

- [Setup guide](SETUP.md)
- [Getting Help, Reporting bugs](https://github.com/caltechlibrary/content-dashboard/issues)
- [About](about.md)

