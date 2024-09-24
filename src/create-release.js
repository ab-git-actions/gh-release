const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');


const gitToken = core.getInput('github_token', {required: false});
const octokit = github.getOctokit(gitToken);

// Fetch the latest Git tag from the repository
async function getLatestTag(owner, repo) {
    try {
        const {data: tags} = await octokit.rest.repos.listTags({
            owner,
            repo,
            per_page: 1 // Get only the latest tag
        });

        if (tags.length === 0) {
            core.info('\u001b[38;5;6mNo tags found in the repository.');
            return null;
        }

        const latestTag = tags[0].name;

        // Loop through the tags and log each one
        tags.forEach((tag) => {
            core.info(`\u001b[35mExisting GitHub tags: ${tag.name}`);
        });

        core.info(`\u001b[38;5;6mLatest tag: ${latestTag}`);

        return latestTag;
    } catch (error) {
        core.error(`\u001b[38;2;255;0;0mError fetching tags: ${error.message}`);
        core.setFailed(`Error fetching tags: ${error.message}`);
    }
}

// Fetch the commit messages since the latest tag
async function getCommitsSinceTag(owner, repo, latestTag) {
    try {

        const { data: { sha: tagCommitSha } } = await octokit.rest.repos.getCommit({
            owner,
            repo,
            ref: latestTag,
        });

        // Fetch the commits after the latest tag up to HEAD
        const {data: commits} = await octokit.rest.repos.listCommits({
            owner,
            repo,
            sha: 'HEAD',
            per_page: 100, // Adjust as necessary
        });


        // Filter commits after the latest tag
        const commitMessages = [];
        const prs = [];
        let foundLatestTag = false;

        const associatedPRs = octokit.rest.repos.listPullRequestsAssociatedWithCommit({
            owner,
            repo,
            commit_sha: commit.sha,
        });



        // Await all promises at once
        const prResults = await Promise.all(prPromises);

        prResults.forEach((associatedPRs, index) => {
            const commit = commits[index];
            const commitMessage = commit.commit.message;


            // Stop adding commits once the latest tag is found in commit history
            if (commit.sha === tagCommitSha) {
                foundLatestTag = true;
                return;
            }

            if (associatedPRs.data.length > 0) {
                associatedPRs.data.forEach((pr) => {
                    prs.push({
                        number: pr.number,
                        title: pr.title,
                        user: pr.user.login,
                    });
                });
            }

            // Add commits that are after the latest tag
            commitMessages.push(commitMessage);

        });


        if (!foundLatestTag) {
            core.warning("\u001b[38;2;255;0;0mWarning: Could not find the latest tag in the commit history.");
        }

        core.info(`\u001b[38;5;6mCommits since ${latestTag}:, ${commitMessages}`);
        return [commitMessages, prs];
    } catch (error) {
        core.error(`\u001b[38;2;255;0;0mError fetching commits: ${error.message}`);
        core.setFailed(`Error fetching commits: ${error.message}`);
    }
}


// Determine the type of version bump based on commit messages
function determineBumpType(commits) {
    let bumpType = 'patch'; // Default bump type

    commits.forEach((commit) => {
        if (commit.startsWith('feat')) {
            bumpType = 'minor'; // Minor bump for features
        }
        if (commit.startsWith('fix')) {
            bumpType = 'patch'; // Patch bump for fixes
        }
        if (commit.startsWith('BREAKING CHANGE') || commit.includes('BREAKING CHANGE')) {
            bumpType = 'major'; // Major bump for breaking changes
        }
    });

    core.info(`\u001b[38;5;6mDetermined bump type: ${bumpType}`);
    return bumpType;
}

// Calculate the next version using semver
function calculateNextVersion(latestTag, bumpType) {
    /**
     * @type {string}
     * @returns A version to be used for gitHub create release tag
     */
    const newVersion = semver.inc(latestTag, bumpType);
    core.info(`\u001b[38;5;6mNew version: ${newVersion}`);
    return newVersion;
}

async function run() {
    try {
        const { owner: gitOrg, repo: gitRepo } = github.context.repo;

        const latestTag = await getLatestTag(gitOrg, gitRepo);

        if (latestTag) {
            // Get commits since the latest tag
            const [commits, prs] = await getCommitsSinceTag(gitOrg, gitRepo, latestTag);

            // Determine the bump type based on commit messages
            const bumpType = determineBumpType(commits);

            // Calculate the next version
            const newVersion = calculateNextVersion(latestTag, bumpType);

            // Create release body with PR information
            let releaseBody = `### Changes since ${latestTag}\n\n`;
            if (prs.length > 0) {
                prs.forEach((pr) => {
                    releaseBody += `- PR #${pr.number}: ${pr.title} by @${pr.user}\n`;
                });
            } else {
                releaseBody += "No new PRs since the latest tag.";
            }

            core.info(`\x1b[38;5;214mRelease body content:\n${releaseBody}`);

            const pushEvent = (github.context.eventName === 'push')

            // This will give you the branch name, like 'refs/heads/main'
            const branchName = github.context.ref.replace('refs/heads/', '');

            if (pushEvent && (branchName === 'main' || branchName === 'master')) {

                const createRelease = await octokit.rest.repos.createRelease({
                    owner: gitOrg,
                    repo: gitRepo,
                    tag_name: newVersion,
                    target_commitish: branchName,
                    name: newVersion,
                    body: releaseBody,
                    prerelease: false,
                    make_latest: 'true'
                })

                const { data: { html_url: releaseUrl } } = createRelease;

                core.info(`\u001b[35m${releaseUrl}`);

                // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
                core.setOutput("GitHub Release URL", releaseUrl)
            }
        }

    }catch(error) {
        core.setFailed(`Action failed with error: ${error.message}`);
    }
}

module.exports = run;
