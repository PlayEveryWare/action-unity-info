import * as core from '@actions/core'
import { Octokit } from '@octokit/core'
import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'

interface UnityVersion {
  projectPath: string
  version: string
  changeset?: string
}

// find the path to ProjectSettings/ProjectVersion.txt
function findProjectVersion(): string {
    // Verify inputs
    const projectPath = core.getInput('path')
    if (!projectPath) {
      throw new Error('No path or project-version supplied to the action')
    }

    // explicit path set?
    const projectVersion = core.getInput('project-version')
    if (projectVersion) {
      const projectVersionPath = path.join(projectPath, projectVersion)
      const projectVersionExists = fs.statSync(projectVersionPath, {throwIfNoEntry: false})
      if (!projectVersionExists) {
        throw new Error(`project-version speicified but path '${projectVersionPath}' does not exist`)
      }

      return projectVersionPath
    }

    // find ProjectVersion.txt
    const paths = glob.sync(`${projectPath}/**/ProjectSettings/ProjectVersion.txt`) || []
    if (paths.length != 1) {
      for (const path of paths) {
        core.error(path);
      }
      throw new Error(`Found ${paths.length} matches for ProjectVersion.txt. Need exactly 1`)
    }

    return paths[0]
}

// determine the Unity project path/version/changeset
async function determinUnityVersion(): Promise<UnityVersion> {
  try {
    core.startGroup('Determining Unity project version')
    const projectVersion = findProjectVersion();

    const versionPath = path.dirname(fs.realpathSync(projectVersion))
    const projectPath = fs.realpathSync(path.join(versionPath, '..'))

    const lines = fs.readFileSync(projectVersion).toString().split('\n')

    // trim trailing carriage returns
    for (const ii in lines) {
      lines[ii] = lines[ii].trimRight()
    }

    // check if we have a newer ProjectVersion.txt with the changeset embedded
    const changesetRegExp = new RegExp('^m_EditorVersionWithRevision: ([^ ]*) \\(([^)]*)\\)$')
    for (const line of lines) {
      const match = changesetRegExp.exec(line)
      if (match) {
        console.log(`Found Unity version (with changeset) ${match[1]} (${match[2]})`)
        return {
          projectPath: projectPath,
          version: match[1],
          changeset: match[2],
        }
      }
    }

    // check for older version string without changeset
    const versionRegExp = new RegExp('^m_EditorVersion: (.*)$')
    for (const line of lines) {
      const match = versionRegExp.exec(line)
      if (match) {
        const version = match[1]
        console.log(`Found Unity version ${version}. Looking up changeset from Unity download archive`)
        return {
          projectPath: projectPath,
          version: version,
        }
      }
    }

    throw new Error(`Failed to find editor version in: '${projectVersion}'`)

  } finally {
    core.endGroup()
  }
}

async function checkImage(unityVersion: string): Promise<boolean> {
  try {
    core.startGroup(`Checking for Unity image '${unityVersion}'`)

    const token = core.getInput('image-token')
    if (!token) {
      throw new Error('Specifying check-image requires image-token')
    }

    const octokit = new Octokit({auth: token})

    const { data } = await octokit.request('GET https://api.github.com/orgs/PlayEveryWare/packages/container/unity/versions')
    for (const image of data) {
      for (const tag of image.metadata.container.tags) {
        if (tag == unityVersion) {
          console.log(`Found matching tag for Unity version '${unityVersion}'`)
          return true;
        }
      }
    }

    console.log(`No matching tag found for Unity version '${unityVersion}'`)
    return false;
  } finally {
    core.endGroup()
  }
}

async function run(): Promise<void> {
  try {

    var unityVersion = await determinUnityVersion()

    const libraryExists = fs.statSync(
        path.join(unityVersion.projectPath, 'Library')
      , { throwIfNoEntry: false }
    )

    const imageName = `ghcr.io/playeveryware/unity:${unityVersion.version}`

    // check for the image if requested
    if (core.getInput('check-image').toLowerCase() == 'true') {
      const imageExists = await checkImage(unityVersion.version)
      core.setOutput('image-exists', imageExists)
    }

    // set outputs
    core.setOutput('project-path', unityVersion.projectPath)
    core.setOutput('unity-version', unityVersion.version)
    core.setOutput('unity-changeset', unityVersion.changeset)
    core.setOutput('library-folder-exists', libraryExists ? true : false)
    core.setOutput('image-name', imageName)
  } catch (err: any) {
    if (err instanceof Error) {
      const error = err as Error
      core.setFailed(error.message)
    } else {
      throw err
    }
  }
}

run()
