/******************************* SETTINGS *****************************/

const defineSettings = [
  {
    key: "maxTasks",
    title: "The maximum number of tasks to show",
    description: "The maximum number of tasks to show",
    default: 3,
    type: "number",
  },
  {
    key: "tagsToHide",
    title: "Tags to hide",
    description:
      "Comma-separated list of tags that should not appear in the selector",
    default: "",
    type: "string",
  },
  {
    key: "tagsToIgnore",
    title: "Tags to ignore",
    description:
      "Comma-separated list of tags whose tasks should not be included in the results",
    default: "",
    type: "string",
  },
  {
    key: "namespacesToIgnore",
    title: "Namespaces to ignore",
    description:
      "Comma-separated list of namespaces whose tasks should not be included in the results",
    default: "",
    type: "string",
  },
];

logseq.useSettingsSchema(defineSettings);
logseq.onSettingsChanged(() => {
  console.log("Quick query setting updated.");
});

/******************************* HELPERS *****************************/

/** Get all the doable tasks on the page named `lowercaseBlockName`.
 * Returns a list of tasks. Each task is an object of the form:
 {
     "properties": {
         "link": "https://doc.akka.io/docs/akka/current/typed/cluster-sharding.html"
     },
     "parent": {
         "id": 9948
     },
     "id": 9947,
     "uuid": "66ca2950-a8ed-43bd-a734-6e2bdcaeb713",
     "path-refs": [
         {
             "id": 4
         }, ....
     ],
     "marker": "TODO",
     "page": {
         "id": 4526
     },
     "refs": [
         {
             "id": 4
         }, ...
     ]
 }
*/
async function getTasks() {
  let ret;
  try {
    ret = await logseq.DB.datascriptQuery(`
      [:find (pull ?task [*])
       :where
       [?task :block/marker ?marker]
       [(contains? #{"TODO" "DOING"} ?marker)]
      ]
    `);
  } catch (e) {
    console.error(e);
  }

  return (ret || []).flat();
}

/**
 * Like getTasksForPage, but returns only the *tags* associated with those tasks.
 * Returns a list of tags. Each tag is an object of the form:
 {
     "id": 9841,
     "created-at": 1724428891233,
     "journal?": false,
     "name": "related work",
     "original-name": "Related work",
     "updated-at": 1724428891233,
     "uuid": "66ca2950-8c1c-42c9-a67e-27c133b2025a"
 }
 * Notice that "name" is just original-name converted to lowercase.
 */
async function getTags() {
  let ret;
  try {
    ret = await logseq.DB.datascriptQuery(`
      [:find (pull ?tag [*])
       :where
       [?task :block/marker ?marker]
       [(contains? #{"TODO" "DOING"} ?marker)]
       ; Get tags of those tasks
       [?task :block/path-refs ?tag]
      ]
    `);
  } catch (e) {
    console.error(e);
  }

  return (ret || []).flat();
}

/**************************** UPDATING RENDERER *****************************/

/** Given a list of tag names, return a renderer query that filters by those tag names. */
function generateRendererQuery(tagNames) {
  if (!tagNames || tagNames.length === 0) {
    return `{{renderer :qquery}}`;
  } else {
    return `{{renderer :qquery, ${tagNames.join(", ")}}}`;
  }
}

/** Given a block that contains {{renderer :query, ...}} in its content, and
 * a list of tag names [tag1, tag2, ...], replace that renderer query with the
 * updated {{renderer :query, tag1, tag2, ...}}.
 */
async function updateRendererQuery(uuid, tagNames) {
  // Fetch the block
  const block = await logseq.Editor.getBlock(uuid);
  const content = block?.content;
  // Find the old renderer query
  const regex = /{{renderer :qquery,?\s*(.*)}}/;
  const match = content.match(regex);
  if (!match) return;
  // Replace the old renderer query with the new one
  const oldQuery = match[0];
  const newQuery = generateRendererQuery(tagNames);
  const newContent = content.replace(oldQuery, newQuery);
  console.log("new content", newContent);
  // Update the block
  await logseq.Editor.updateBlock(uuid, newContent);
}

/** Given a block that contains {{renderer :qquery, tag1, tag2, ...}} in its content,
 * return [tag1, tag2, ...]. */
async function parseRendererQuery(uuid) {
  // Get the block
  const block = await logseq.Editor.getBlock(uuid);
  const content = block?.content;
  // Parse its contents
  const regex = /{{renderer :qquery,?\s*(.*)}}/;
  const match = content.match(regex);
  if (match && match[1]) {
    return match[1].split(",").map((tag) => tag.trim());
  } else {
    return [];
  }
}

/**************************** Fetching tasks *****************************/

/** Given a list of tag names the user selected, return an object with:
 * - selectedTags: the tags that the user has selected
 * - remainingTags: the tags in the filtered tasks that are not selected
 * - filteredTasks: the tasks that have all the selected tags
 */
async function getTagsAndTasks(selectedTagNames) {
  const tasks = await getTasks();
  const tags = await getTags();

  // Get the tags that the user has selected, in the order they selected them---
  // likewise with the tags and the namespaces they asked us to ignore.
  const selectedTags = selectedTagNames
    .map((tagName) => tags.find((tag) => tag.name === tagName))
    .filter((tag) => !!tag); // Filter out any tag names that didn't map to anything

  const tagsToIgnoreNames = logseq.settings.tagsToIgnore.split(",");
  const tagsToIgnore = [];
  for (const name of tagsToIgnoreNames) {
    const page = await logseq.Editor.getPage(name);
    if (page) tagsToIgnore.push(page);
  }

  const namespaces = logseq.settings.namespacesToIgnore.split(",");
  const pagesToIgnore = [];
  for (let i = 0; i < namespaces.length; i++) {
    const nsPages = await logseq.Editor.getPagesFromNamespace(namespaces[i]);
    pagesToIgnore.push(...nsPages);
  }

  console.log("Ignoring tags", tagsToIgnore);
  console.log("Ignoring pages", pagesToIgnore);

  // Get the tasks that have all the selected tags, and none of the ignored tags
  const tasksWithTags = tasks.filter(
    (task) =>
      // Check if the task is on a page that should be ignored
      !pagesToIgnore.some((page) => task.page.id === page.id) &&
      // Check if the task has all the selected tags
      selectedTags.every((tag) =>
        task["path-refs"].map((obj) => obj.id).includes(tag.id),
      ) &&
      // Check if the task has none of the ignored tags
      tagsToIgnore.every(
        (tag) => !task["path-refs"].map((obj) => obj.id).includes(tag.id),
      ),
  );
  console.log("tasksWithTags", tasksWithTags);
  // Filter out the tasks with causal dependencies
  const dependentTaskIDs = await getDependentTaskIDs(tasksWithTags);
  const filteredTasks = tasksWithTags.filter(
    (task) => !dependentTaskIDs.has(task.id),
  );
  console.log("filteredTasks", filteredTasks);

  // Get the properties of those tasks
  const taskProperties = new Set(
    filteredTasks.map((task) => task["properties-order"]).flat(),
  );

  // Get the tags in the filtered tasks that are not selected or
  // are otherwise undesirable
  const remainingTags = tags.filter((tag) => {
    // Filter out selected tags
    if (selectedTagNames.includes(tag.name)) return false;
    // Filter out tags that are properties of the tasks
    if (taskProperties.has(tag.name)) return false;
    // Filter out "todo" and "doing" tags
    if (tag.name === "todo" || tag.name === "doing") return false;
    // Filter out journal tags
    if (tag["journal?"]) return false;
    // Filter out tags that should be ignored in settings
    if (logseq.settings.tagsToHide.toLowerCase().split(",").includes(tag.name))
      return false;
    // Filter out tags that are not in the filtered tasks
    if (
      !filteredTasks.some((task) =>
        task["path-refs"].map((obj) => obj.id).includes(tag.id),
      )
    )
      return false;

    return true;
  });

  // Sort the tags by name
  remainingTags.sort((a, b) => a.name.localeCompare(b.name));

  return { selectedTags, remainingTags, filteredTasks };
}

/** Given a list of tasks, use task enumeration to identify *causal dependencies*.
 * Return the set of IDs for tasks that depend on other tasks. */
async function getDependentTaskIDs(tasks) {
  // Get the ancestors of each task
  const ancestors = {};
  for (const task of tasks) {
    ancestors[task.id] = await getAncestors(task);
    //console.log(
    //  `Ancestors of "${task.content.slice(0, 25)}...":`,
    //  ancestors[task.id],
    //);
  }

  //console.log("Checking tasks for dependencies...", tasks);
  // For each pair of tasks, check if one depends on the other
  const dependentTaskIDs = new Set();
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const t1 = tasks[i];
      const t2 = tasks[j];
      const comparison = compareTasks(t1, t2, ancestors);
      if (comparison < 0) {
        // t1 is a dependency of t2
        //console.log(
        //  `"${t1.content.slice(0, 25)}..." happens before "${t2.content.slice(0, 25)}..."`,
        //);
        dependentTaskIDs.add(t2.id);
      } else if (comparison > 0) {
        // t1 depends on t2
        //console.log(
        //  `"${t2.content.slice(0, 25)}..." happens before "${t1.content.slice(0, 25)}..."`,
        //);
        dependentTaskIDs.add(t1.id);
      } else {
        // neither depends on the other
        // do nothing
        //console.log(
        //  `"${t1.content.slice(0, 25)}..." and "${t2.content.slice(0, 25)}..." are independent`,
        //);
      }
    }
  }

  //console.log("Filtering out task IDs", dependentTaskIDs);

  return dependentTaskIDs;
}

/** Returns negative if t1 is a dependency of t2, positive if t1 depends on t2, and
 * returns 0 if neither depends on the other.
 * ancestors is a map from task id to the list of ancestors of that task.
 */
function compareTasks(t1, t2, ancestors) {
  // If T1 and T2 are ordered blocks and have the same parent then T1 is the dependency
  // iff T1 is before T2 in the parent's children array.
  //
  // Example where T1 is the dependency of T2:
  // - Parent
  //   1. T1
  //   2. ???
  //   3. T2
  //
  // In general, let T1 and T2 be tasks with the nearest common ancestor B.
  // Let C1 be the child of B that is an ancestor of T1, and let C2 be the child
  // of B that is an ancestor of T2. (C1 and C2 are the "furthest uncommon ancestors"
  // of T1 and T2.) Then T1 is the dependency of T2 iff:
  // 1. C1 is before C2 in B's children array, and
  // 2. Both C1 and C2 are ordered blocks.
  //
  // Example where T1 is the dependency of T2:
  // - Parent
  //   1. T1
  //   2. C2
  //      - T2  (notice that T2 doesn't have to be a numbered block!)
  //
  // Another example:
  // - Foo
  //   - Bar
  //     - Qux (this is the nearest common ancestor of T1 and T2)
  //       1. ???
  //       2. C1
  //          - T1
  //       3. ???
  //       4. C2
  //          - Qux
  //            - T2
  //
  // Edge case: one task is the ancestor of the other. In this case,
  // counterintuitively, the *descendant* is the dependency.

  // If the tasks are not located on the same page, then they are not dependent.
  if (t1.page.id !== t2.page.id) {
    return 0;
  }

  // If one task is the ancestor of the other, then the descendant is the dependency.
  if (ancestors[t1.id].some((ancestor) => ancestor.id === t2.id)) {
    return -1;
  } else if (ancestors[t2.id].some((ancestor) => ancestor.id === t1.id)) {
    return 1;
  }

  // Find the nearest common ancestor of t1 and t2.
  let nearestCommonAncestor = null;
  let furthestUncommonAncestor1 = t1;
  let furthestUncommonAncestor2 = t2;
  outerLoop: for (const c1 of ancestors[t1.id]) {
    for (const c2 of ancestors[t2.id]) {
      // Invariant: furthestUncommonAncestor1 comes before c1 in the ancestors list of t1,
      // and furthestUncommonAncestor2 comes before c2 in the ancestors list of t2.
      if (c1.id === c2.id) {
        nearestCommonAncestor = c1;
        break outerLoop;
      }
      furthestUncommonAncestor2 = c2;
    }
    furthestUncommonAncestor1 = c1;
    furthestUncommonAncestor2 = t2; // reset this!
  }
  // Crash if any of these are not defined.
  if (
    !nearestCommonAncestor ||
    !furthestUncommonAncestor1 ||
    !furthestUncommonAncestor2
  ) {
    console.log("no common ancestor:", t1, t2, ancestors);
    throw new Error("Programming error finding common ancestor of tasks");
  }
  // console.log(
  //   "Tasks",
  //   t1,
  //   t2,
  //   "have nearest common ancestor",
  //   nearestCommonAncestor,
  //   "and furthest uncommon ancestors",
  //   furthestUncommonAncestor1,
  //   furthestUncommonAncestor2,
  // );

  // Check if the conditions for T1 being the dependency of T2 are met.
  if (
    isOrderedBlock(furthestUncommonAncestor1) &&
    isOrderedBlock(furthestUncommonAncestor2)
  ) {
    // The "children" array is a map of ['uuid', uuid] pairs.
    const children = nearestCommonAncestor.children.map((c) => c[1]);
    const index1 = children.indexOf(furthestUncommonAncestor1.uuid);
    const index2 = children.indexOf(furthestUncommonAncestor2.uuid);
    if (index1 < index2) {
      return -1;
    } else {
      return 1;
    }
  } else {
    return 0;
  }
}

/** Returns the list of this block's ancestors---more recent ancestors come first.
 * The last ancestor is the page the block is on. */
async function getAncestors(block) {
  const ancestors = [];
  let currentBlock = block;
  while (!isPage(currentBlock)) {
    currentBlock =
      (await logseq.Editor.getBlock(currentBlock.parent.id)) ||
      (await logseq.Editor.getPage(currentBlock.parent.id));
    ancestors.push(currentBlock);
  }
  return ancestors;
}

/** Returns true iff the block is a page. */
function isPage(block) {
  // A page is just a block without a parent.
  return !block.parent;
}

/** Checks if the task may have causal dependencies. */
function isOrderedBlock(block) {
  return (
    block.properties &&
    // I have no idea why both of these are possible
    (block.properties["logseq.order-list-type"] === "number" ||
      block.properties["logseq.orderListType"] === "number")
  );
}

/**************************** MAIN *****************************/

function main() {
  const getKey = (uuid) => `qquery_${uuid}`;

  /////////////////////////// REGISTER THE COMMAND ///////////////////////////

  logseq.Editor.registerSlashCommand("Quick query", async () => {
    const { content, uuid } = await logseq.Editor.getCurrentBlock();
    await logseq.Editor.insertAtEditingCursor(`{{renderer :qquery}} `);
    await logseq.Editor.exitEditingMode();
  });

  ///////////////////////////////// CSS /////////////////////////////////

  logseq.provideStyle(`
      .qquery {
        white-space: normal;
      }

      .qquery-tag-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--ls-primary-text-color);
      }

      .qquery-tag-btn {
         border: 1px solid var(--ls-border-color);
         white-space: initial;
         padding: 2px 8px;
         border-radius: 16px;
         cursor: pointer;
      }

      .qquery-task-count {
        padding-top: 2px;
        color: var(--ls-primary-text-color);
      }

      .qquery-tag-selected {
        background-color: var(--ls-selection-background-color);
      }
      `);

  ///////////////////////////////// RENDER /////////////////////////////////

  async function renderComponent(uuid, slot, selectedTagNames) {
    // Get the selected tags, remaining tags, and filtered tasks
    const tagsAndTasks = await getTagsAndTasks(selectedTagNames);
    if (!tagsAndTasks) return renderFailure(uuid, slot);
    const { selectedTags, remainingTags, filteredTasks } = tagsAndTasks;

    console.log("selectedTags", selectedTags);
    console.log("filteredTasks", filteredTasks);

    // Get the children of the block
    const block = await logseq.Editor.getBlock(uuid);
    const children = block.children ? block.children.map((x) => x[1]) : [];
    console.log("children", children);

    // The set of tasks that are already embedded
    const embeddedTasks = new Set();

    // Remove the embedded tasks that are no longer needed
    for (let i = 0; i < children.length; i++) {
      // Get the child's contents
      const child = await logseq.Editor.getBlock(children[i]);
      // Regex matching children of the form (($uuid))
      const regex = /\(\(([0-9a-f-]+)\)\)/;
      const match = child.content.match(regex);
      if (match) {
        const taskUuid = match[1];
        if (filteredTasks.map((task) => task.uuid).includes(taskUuid)) {
          console.log("keeping child", child);
          embeddedTasks.add(taskUuid);
        } else {
          console.log("removing child", child);
          await logseq.Editor.removeBlock(children[i]);
        }
      } else {
        console.log("ignoring child", child);
      }
    }

    // Add the embedded tasks that are needed
    let taskCount = embeddedTasks.size;
    for (let i = 0; i < filteredTasks.length; i++) {
      const task = filteredTasks[i];
      if (
        !embeddedTasks.has(task.uuid) &&
        taskCount < logseq.settings.maxTasks
      ) {
        const newChild = await logseq.Editor.insertBlock(
          uuid,
          `((${task.uuid}))`,
        );
        taskCount++;
        console.log("added child", newChild);
      }
    }

    setTimeout(() => {
      logseq.Editor.exitEditingMode();
    }, 20);

    // Render the tag listing
    renderTagListing({
      slot,
      uuid,
      selectedTags,
      remainingTags,
      filteredTasks,
    });
  }

  function renderFailure(uuid, slot) {
    return logseq.provideUI({
      key: getKey(uuid),
      slot,
      reset: true,
      template: `Quick Query couldn't find any tasks related to the current page!`,
    });
  }

  function renderTagListing({
    slot,
    uuid,
    selectedTags,
    remainingTags,
    filteredTasks,
  }) {
    const overflowTasks = filteredTasks.length - logseq.settings.maxTasks;
    return logseq.provideUI({
      key: getKey(uuid),
      slot,
      reset: true,
      template: `
            <div
            class="qquery"
            data-slot-id="${slot}"
            data-block-uuid="${uuid}" >
              <div class="qquery-tag-container">
                <a class="button" data-slot-id="${slot}" data-block-uuid="${uuid}" data-on-click="reload">
                  <svg xmlns="http://www.w3.org/2000/svg" class="icon icon-tabler icon-tabler-reload" width="100%" height="100%" viewBox="0 0 24 24" stroke-width="1.5" stroke="#2c3e50" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747" />
                    <path d="M20 4v5h-5" />
                  </svg>
                </a>
                ${selectedTags.map((tag) => _renderTag(tag, slot, uuid, true)).join("")}
                ${remainingTags.map((tag) => _renderTag(tag, slot, uuid, false)).join("")}
              </div>
            </div>
          `,
    });
  }

  function _renderTag(tag, slot, uuid, isSelected) {
    return `
      <button
        data-on-click="${isSelected ? "unselectTag" : "selectTag"}"
        data-slot-id="${slot}"
        data-block-uuid="${uuid}"
        data-tag-name="${tag.name}"
        class="button qquery-tag-btn ${isSelected ? "qquery-tag-selected" : ""}"
      >
        ${tag.name}
      </button>
    `;
  }

  ///////////////////////////////// EVENT HANDLERS /////////////////////////////////

  logseq.provideModel({
    async reload(event) {
      const slot = event.dataset.slotId;
      const uuid = event.dataset.blockUuid;
      const selectedTagNames = await parseRendererQuery(uuid);
      return await renderComponent(uuid, slot, selectedTagNames);
    },
    async selectTag(event) {
      const slot = event.dataset.slotId;
      const uuid = event.dataset.blockUuid;
      const tagName = event.dataset.tagName;
      const selectedTagNames = await parseRendererQuery(uuid);

      // Update the block with the new tags
      selectedTagNames.push(tagName);
      await updateRendererQuery(uuid, selectedTagNames);

      return await renderComponent(uuid, slot, selectedTagNames);
    },
    async unselectTag(event) {
      const slot = event.dataset.slotId;
      const uuid = event.dataset.blockUuid;
      const tagName = event.dataset.tagName;
      const selectedTagNames = await parseRendererQuery(uuid);

      // Update the block with the new tags
      selectedTagNames.splice(selectedTagNames.indexOf(tagName), 1);
      await updateRendererQuery(uuid, selectedTagNames);

      return await renderComponent(uuid, slot, selectedTagNames);
    },
  });

  // Implement the renderer for qquery
  logseq.App.onMacroRendererSlotted(async ({ slot, payload }) => {
    // The arguments of {{renderer foo bar, baz beans, qux}} are ["foo bar", "baz beans", "qux"].
    // For us, the first argument is :qquery.
    // The rest of the arguments are the tags that the user has selected, in all-lowercase.
    if (payload.arguments[0] !== ":qquery") return;
    const uuid = payload.uuid;

    const selectedTagNames = await parseRendererQuery(uuid);
    const tagsAndTasks = await getTagsAndTasks(selectedTagNames);
    if (!tagsAndTasks) return renderFailure(uuid, slot);
    const { selectedTags, remainingTags, filteredTasks } = tagsAndTasks;

    return renderTagListing({
      slot,
      uuid,
      selectedTags,
      remainingTags,
      filteredTasks,
    });
  });
}

// bootstrap
logseq.ready(main).catch(console.error);
