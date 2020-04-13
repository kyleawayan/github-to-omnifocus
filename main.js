'use strict';

const osa = require('osa2');
const toml = require('toml');
const fs = require('fs')
const { Octokit } = require("@octokit/rest");

const getInboxTasks = osa(() => {
    var of = Application("OmniFocus")
    of.includeStandardAdditions = true;
    return of.defaultDocument
        .inboxTasks()
        .filter((task) => task.completed() === false)
        .map((task) => {
            return { "id": task.id(), "name": task.name() };
        });
})

const newTask = osa((projectName, title, tag, taskNote) => {

    const ofApp = Application("OmniFocus")
    const ofDoc = ofApp.defaultDocument

    // https://discourse.omnigroup.com/t/automatically-flag-tasks-in-specific-projects-contexts-according-to-due-defer-date/32093/28
    const tagFoundOrCreated = charTag => {
        const
            tags = ofDoc.flattenedTags.whose({
                name: charTag
            }),
            oTag = ofApp.Tag({
                name: charTag
            });
        return tags.length === 0 ? (
            (
                ofDoc.tags.push(oTag),
                oTag
            )
        ) : tags()[0]
    }

    const project = ofDoc.flattenedProjects
        .whose({ name: projectName })[0];

    var task = ofApp.Task({
        "name": title,
        "primaryTag": tagFoundOrCreated(tag),
        "note": taskNote,
    })
    // ofDoc.inboxTasks.push(task)
    project.tasks.push(task)
    return { "id": task.id(), "name": task.name() };
});

const tasksForProject = osa((projectName) => {
    const ofApp = Application("OmniFocus")
    const ofDoc = ofApp.defaultDocument
    const project = ofDoc.flattenedProjects
        .whose({ name: projectName })[0];

    return project.tasks()
        .filter((task) => task.completed() === false)
        .map((task) => {
            return { "id": task.id(), "name": task.name() };
        });
});

const markTaskComplete = osa((taskId) => {
    const task = Application('OmniFocus').defaultDocument.flattenedTasks().filter(task => task.id() === taskId)
    if (task) {
        return Application('OmniFocus').markComplete(task)
    }
    return false
});


async function main() {

    var tomlConfig, config

    try {
        tomlConfig = fs.readFileSync('/Users/mike/.github-to-omnifocus', 'utf8')
    } catch (err) {
        console.error(err)
    }

    try {
        config = toml.parse(tomlConfig);
    } catch (e) {
        console.error("Parsing error on line " + e.line + ", column " + e.column +
            ": " + e.message);
    }

    console.log(`Using API server: ${config.github.gh_api_url}`);
    console.log(`Using token: ${config.github.gh_auth_token}`);

    const octokit = new Octokit({
        auth: config.github.gh_auth_token, // token
        userAgent: "github-to-omnifocus/1.0.0",
        baseUrl: config.github.gh_api_url,
        log: console,
    })
    var issues = await octokit.issues.list({
        filter: "assigned",
        state: "open"
    })

    tasksForProject('GitHub Issues')
        .then(result => {
            var tasks = result.map(t => t.name)
            addNewIssues(tasks, issues)
            // TODO complete issues missing from the list
            completeMissingIssues(result, issues)
        });
}

async function addNewIssues(currentTasks, issues) {

    // addIssueToOmniFocus understands how to take the JSON from
    // the GH API for an issue and make a task for it.
    const addIssueToOmniFocus = t => {
        const taskName = t.repository.full_name + "#" + t.number + " " + t.title
        const taskURL = t.html_url
        return newTask('GitHub Issues', taskName, "github", taskURL)
    }
    // currentTasks.forEach(t => console.log(t))
    try {
        // Add new tasks
        var addTaskPromises = []
        issues.data
            .filter(t => {
                // Filter out issues where we appaear to alrady have
                // an associated task.
                // We assume the user hasn't changed the task prefix,
                // which should be unique to the issue.
                var prefix = t.repository.full_name + "#" + t.number
                console.log("Found issue: " + prefix)
                return !currentTasks.some(e => e.startsWith(prefix))
            })
            .forEach(t => {
                var prefix = t.repository.full_name + "#" + t.number
                console.log("Adding issue: " + prefix)
                addTaskPromises.push(addIssueToOmniFocus(t))
            })
        // console.log(addTaskPromises)
        console.log("Waiting for " + addTaskPromises.length + " tasks to be added...")
        await Promise.all(addTaskPromises).then(() => {
            console.log("Issues added!")
        })

    } catch (err) {
        console.error(err.message)
    }
}

async function completeMissingIssues(currentTasks, issues) {
    // TODO
    // find tasks in currentTasks with no issue in issues, mark complete
}

main()
