/** Do not show more than MAX_TASKS tasks. */
const MAX_TASKS = 3;

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
async function getTasksForPage(lowercaseBlockName) {
  let ret;
  try {
    ret = await logseq.DB.datascriptQuery(`
      [:find (pull ?task [*])
       :where
       ; Get current page
       [?page :block/name "${lowercaseBlockName}"]
       ; Get tasks on the page, or tasks that reference the page
       (or [?task :block/page ?page]
           [?task :block/path-refs ?page])
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
async function getTagsForPage(lowercaseBlockName) {
  let ret;
  try {
    ret = await logseq.DB.datascriptQuery(`
      [:find (pull ?tag [*])
       :where
       ; Get current page
       [?page :block/name "${lowercaseBlockName}"]
       ; Get tasks on the page, or tasks that reference the page
       (or [?task :block/page ?page]
           [?task :block/path-refs ?page])
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

/** Given a list of tag names the user selected, return an object with:
 * - selectedTags: the tags that the user has selected
 * - remainingTags: the tags in the filtered tasks that are not selected
 * - filteredTasks: the tasks that have all the selected tags
 */
async function getTagsAndTasks(selectedTagNames) {
  const page = await logseq.Editor.getCurrentPage();
  const tasks = await getTasksForPage(page.name);
  const tags = await getTagsForPage(page.name);

  // Get the tags that the user has selected
  const selectedTags = tags.filter((tag) =>
    selectedTagNames.includes(tag.name),
  );
  // Get the tasks that have all the selected tags
  const filteredTasks = tasks.filter((task) =>
    selectedTags.every((tag) =>
      task["path-refs"].map((obj) => obj.id).includes(tag.id),
    ),
  );
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
    // Filter out the current page
    if (tag.uuid === page.uuid) return false;
    // Filter out "todo" and "doing" tags
    if (tag.name === "todo" || tag.name === "doing") return false;
    // Filter out journal tags
    if (tag["journal?"]) return false;
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

/********* MAIN  *********/

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
    const { selectedTags, remainingTags, filteredTasks } =
      await getTagsAndTasks(selectedTagNames);

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
      // Regex matching children of the form {{embed (($uuid))}}
      const regex = /{{embed \(\(([0-9a-f-]+)\)\)}}/;
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
      if (!embeddedTasks.has(task.uuid) && taskCount < MAX_TASKS) {
        const newChild = await logseq.Editor.insertBlock(
          uuid,
          `{{embed ((${task.uuid}))}}`,
        );
        taskCount++;
        console.log("added child", newChild);
      }
    }

    setTimeout(() => {
      logseq.Editor.exitEditingMode();
    }, 100);

    // Render the tag listing
    renderTagListing({
      slot,
      uuid,
      selectedTags,
      remainingTags,
      filteredTasks,
    });
  }

  function renderTagListing({
    slot,
    uuid,
    selectedTags,
    remainingTags,
    filteredTasks,
  }) {
    const overflowTasks = filteredTasks.length - MAX_TASKS;
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
    const { selectedTags, remainingTags, filteredTasks } =
      await getTagsAndTasks(selectedTagNames);

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
