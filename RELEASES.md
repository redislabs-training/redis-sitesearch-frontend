# Release Process

Release versions follow [Semver](https://semver.org/). To create a new release, use the following process.

1. Commit and push changes on a feature branch, and create a pull request against `master`. Include updates to the `CHANGELOG`.

2. After merging changes, run `yarn run version` on `master` to increment version numbers and tag the release.

3. If everything looks good, push tags to GitHub, `git push origin master --tags`

4. In GitHub, create a release from the new tag in the following format.

Title:

```
v1.0.0
```

Description (copy directly from `CHANGELOG`):

```md
## v2.0.0 (June 21, 2021)

- BREAKING: Call `search` function on focus

After creating the release, a GitHub action will run to publish the release to npm.
