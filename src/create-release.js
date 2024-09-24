const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');


const gitToken = core.getInput('github_token', {required: false});
const octokit = github.getOctokit(gitToken || process.env.github_token);

// Fetch the latest Git tag from the repository
async function getLatestTag(owner, repo) {
    try {
        const {data: tags} = await octokit.rest.repos.listTags({
            owner,
            repo,
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
        const prSet = new Set(); // To track unique PR numbers
        let foundLatestTag = false;

        for (const commit of commits) {
            const commitMessage = commit.commit.message;

            // Stop adding commits once the latest tag is found in commit history
            if (commit.sha === tagCommitSha) {
                foundLatestTag = true;
                break;
            }

            const {data: associatedPRs} = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
                owner,
                repo,
                commit_sha: commit.sha,
            });

            associatedPRs.forEach((pr) => {
                if (!prSet.has(pr.number)) {
                    prSet.add(pr.number); // Add the PR number to the Set
                    prs.push({
                        number: pr.number,
                        title: pr.title,
                        user: pr.user.login,
                    });
                }
            });

            // Add commits that are after the latest tag
            commitMessages.push(commitMessage);
        }

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
async function determineBumpType(commits) {
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
async function calculateNextVersion(latestTag, bumpType) {
    /**
     * @type {string}
     * @returns A version to be used for gitHub create release tag
     */
    const newVersion = semver.inc(latestTag, bumpType);
    core.info(`\u001b[38;5;6mNew version: ${newVersion}`);
    return newVersion;
}

async function createGitRelease(owner, repo, newVersion, targetCommitish, releaseBody) {

    const { data: { html_url: releaseUrl } } = await octokit.rest.repos.createRelease({
        owner: owner,
        repo: repo,
        tag_name: newVersion,
        target_commitish: targetCommitish, // The latest commit (HEAD)
        name: newVersion,
        body: releaseBody,
        prerelease: false,
        make_latest: 'true'
    });

    return releaseUrl;
}

async function run() {
    try {
        const { owner: gitOrg, repo: gitRepo } = github.context.repo;

        const { eventName, ref } = github.context;
        const pushEvent = (eventName === 'push');
        const branchName = ref.replace('refs/heads/', '');

        const latestTag = await getLatestTag(gitOrg, gitRepo);

        let newVersion;

        // If no tags were found, latestTag would be null, meaning a new tag will be created
        if (!latestTag) {
            // Create the initial tag (v0.1.0) and release
            newVersion = 'v0.1.0';
            core.info('\u001b[38;5;6mCreating initial release v0.1.0.');

            const { data: commitData } = await octokit.rest.repos.getCommit({
                owner: gitOrg,
                repo: gitRepo,
                ref: branchName,
            });

            // Get commits and PRs for the "Initial release"
            const [commits, prs] = await getCommitsSinceTag(gitOrg, gitRepo, commitData.sha);

            // Create initial release body and append PR info
            let releaseBody = "Initial release.\n\n";

            if (prs.length > 0) {
                releaseBody += "### Pull Requests included in this release:\n";
                prs.forEach((pr) => {
                    releaseBody += `- PR #${pr.number}: ${pr.title} by @${pr.user}\n`;
                });
            } else {
                releaseBody += "No PRs included in this initial release.";
            }

            const releaseUrl = await createGitRelease(gitOrg, gitRepo, newVersion, branchName, releaseBody);

            core.info(`\u001b[35mRelease created: ${releaseUrl}`);

            // Set the output variables for use by other actions
            core.setOutput("release_url", releaseUrl);

            return; // Exit after creating the initial release
        }


        // Get commits since the latest tag
        const [commits, prs] = await getCommitsSinceTag(gitOrg, gitRepo, latestTag);

        // Determine the bump type based on commit messages
        const bumpType = await determineBumpType(commits);

        // Calculate the next version
        const nextVersion = await calculateNextVersion(latestTag, bumpType);

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


        if (pushEvent && (branchName === 'main' || branchName === 'master')) {

            const releaseUrl = await createGitRelease(gitOrg, gitRepo, nextVersion, branchName, releaseBody);

            core.info(`\u001b[35m${releaseUrl}`);

            // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
            core.setOutput("release_url", releaseUrl)
        }
    }catch(error) {
        core.setFailed(`Action failed with error: ${error.message}`);
    }
}

module.exports = run;
