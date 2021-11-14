import { promises as fs } from "fs"
import core from "@actions/core"
import { GitHub, context } from "@actions/github"

import { parse } from "./lcov"
import { diff } from "./comment"

function getCommitSHA() {
  if (context.eventName === "workflow_run") {
    core.info("Action was triggered by workflow_run: using SHA and RUN_ID from triggering workflow")
    const event = context.payload
    if (!event.workflow_run) {
      throw new Error('Event of type "workflow_run" is missing "workflow_run" field')
    }
    return event.workflow_run.head_commit.id
  }

  if (context.payload.pull_request) {
    core.info(`Action was triggered by ${context.eventName}: using SHA from head of source branch`)
    const pr = context.payload.pull_request
    return pr.head.sha
  }

  return context.sha
}

async function main() {
	const token = core.getInput("github-token", { required: true })
	const name = core.getInput("name", { required: true })
	const lcovFile = core.getInput("lcov-file")
	const baseFile = core.getInput("lcov-base")

	const raw = await fs.readFile(lcovFile, "utf-8").catch(err => null)
	if (!raw) {
		console.log(`No coverage report found at "${lcovFile}", exiting...`)
		return
	}

	const baseRaw = baseFile && await fs.readFile(baseFile, "utf-8").catch(err => null)
	if (baseFile && !baseRaw) {
		console.log(`No coverage report found at "${baseFile}", ignoring...`)
	}

	const options = {
		repository: context.payload.repository.full_name,
		prefix: `${process.env.GITHUB_WORKSPACE}/`,
	}

	if (context.eventName === "pull_request") {
		options.commit = context.payload.pull_request.head.sha
		options.head = context.payload.pull_request.head.ref
		options.base = context.payload.pull_request.base.ref
	} else if (context.eventName === "push") {
		options.commit = context.payload.after
		options.head = context.ref
	}

	const github = new GitHub(token)
	const head_sha = getCommitSHA()
	const checkCreatePromise = github.checks.create({
		head_sha,
		name,
		status: "in_progress",
		output: {
			title: name,
			summary: ""
		},
		...context.repo
	})

	const lcov = await parse(raw)
	const baselcov = baseRaw && await parse(baseRaw)
	const body = diff(lcov, baselcov, options)

	const createResult = await checkCreatePromise
	const updateResult = await github.checks.update({
		check_run_id: createResult.data.id,
		conclusion: 'success',
		status: "completed",
		output: {
			title: `${name} ${icon}`,
			summary: body,
		},
		...context.repo
	})

	core.info(`Check run create response: ${updateResult.status}`)
	core.info(`Check run URL: ${updateResult.data.url}`)
	core.info(`Check run HTML: ${updateResult.data.html_url}`)
}

main().catch(function(err) {
	console.log(err)
	core.setFailed(err.message)
})
