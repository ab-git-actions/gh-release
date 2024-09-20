const core = require('@actions/core');

async function generateRelease() {
    try {
        const { default: semanticRelease } = await import('semantic-release');
        // Run semantic-release programmatically
        const result = await semanticRelease({
            branches: ['main', 'master'], // Adjust based on your branch configuration
            dryRun: false, // Set to true for testing without creating a release
        });

        // Ensure the result exists and there is a next release
        if (result && result.nextRelease) {
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

module.exports = { generateRelease };
