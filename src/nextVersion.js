const core = require('@actions/core');

async function generateRelease() {
    // Run semantic-release programmatically
    const result = await import('semantic-release');
    try {
        if (result) {
            const nextVersion = result.nextRelease.version;
            const releaseBody = result.nextRelease.notes;
            const latestSha = result.commit; // or retrieve the latest commit sha

            core.info(`Next version is: ${nextVersion}`);
            core.info(`Release notes: ${releaseBody}`);

            return {
                nextVersion,
                releaseBody,
                latestSha
            };
        }
    } catch (error) {
        console.log(error);
    }
}

module.exports = generateRelease;
