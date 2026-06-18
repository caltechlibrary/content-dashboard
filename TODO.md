
# Action items

## Bugs

- [x] The static content isn't being handled correctly, looks like middleware is returning 400 errors for static content
- [ ] Router test bugs, the URL `http://localhost/...` are not correct in the test. They need to include the port the router is living on

## Next

- [x] I'd like the dataset webservice to run on 8201 and the middleware (content-dashboard) to run on port 8200.
- [x] Rename content-dashboard-router to content-dashboard
- [x] Rename api-router.yaml to content_dashboard.yaml
- [x] Reference from `127.0.0.1` needs to be replaced with `localhost` by default
  - [x] The port for content-dashboard should be part of the content_dashboard.yaml configuration


