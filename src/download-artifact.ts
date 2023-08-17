import * as os from 'os'
import * as path from 'path'
import * as core from '@actions/core'
import * as artifact from '@actions/artifact'
import {Inputs, Outputs} from './constants'
import {chunk} from './utils'

// todo: make this configurable?
const PARALLEL_DOWNLOADS = 5

async function run(): Promise<void> {
  const inputs = {
    name: core.getInput(Inputs.Name, {required: false}),
    path: core.getInput(Inputs.Path, {required: true}),
    token: core.getInput(Inputs.GitHubToken, {required: true}),
    repository: core.getInput(Inputs.Repository, {required: true}),
    runID: parseInt(core.getInput(Inputs.RunID, {required: true})) // TODO: parse int or use as string?
  }

  if (inputs.path.startsWith(`~`)) {
    inputs.path = inputs.path.replace('~', os.homedir())
  }

  const resolvedPath = path.resolve(inputs.path)
  core.debug(`Resolved path is ${resolvedPath}`)

  const [owner, repo] = inputs.repository.split('/')
  if (!owner || !repo) {
    throw new Error(
      `Invalid repository: ${inputs.repository}. Must be in format owner/repo`
    )
  }

  const artifactClient = artifact.create()

  if (inputs.name) {
    const {artifact: targetArtifact} = await artifactClient.getArtifact(
      inputs.name,
      inputs.runID,
      owner,
      repo,
      inputs.token
    )

    if (!targetArtifact) {
      throw new Error(`Artifact '${inputs.name}' not found`)
    }

    core.debug(
      `Found artifact for ${inputs.name} (ID: ${targetArtifact.id}, Size: ${targetArtifact.size})`
    )

    const out = await artifactClient.downloadArtifact(
      targetArtifact.id,
      owner,
      repo,
      inputs.token,
      {path: resolvedPath}
    )

    if (!out.success) {
      throw new Error(`Failed to download artifact '${inputs.name}'`)
    }

    core.info(
      `Artifact ${targetArtifact.name} was downloaded to ${resolvedPath}`
    )
  } else {
    const {artifacts} = await artifactClient.listArtifacts(
      inputs.runID,
      owner,
      repo,
      inputs.token
    )

    if (artifacts.length === 0) {
      throw new Error(
        `No artifacts found for run ${inputs.runID} in ${inputs.repository}`
      )
    }

    core.debug(`Found ${artifacts.length} artifacts`)

    const downloadPromises = artifacts.map(artifact =>
      artifactClient.downloadArtifact(artifact.id, owner, repo, inputs.token, {
        path: resolvedPath
      })
    )

    const chunkedPromises = chunk(downloadPromises, PARALLEL_DOWNLOADS)
    for (const chunk of chunkedPromises) {
      await Promise.all(chunk)
    }

    core.info(`There were ${artifacts.length} artifacts downloaded`)
  }

  core.setOutput(Outputs.DownloadPath, resolvedPath)
  core.info('Download artifact has finished successfully')
}

run().catch(err => core.setFailed(err.message))
