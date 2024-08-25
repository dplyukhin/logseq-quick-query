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
       ; Get tasks on the page
       [?task :block/page ?page]
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
       ; Get tasks on the page
       [?task :block/page ?page]
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
  // Get the tags in the filtered tasks that are not selected
  const remainingTags = tags.filter((tag) => {
    if (selectedTagNames.includes(tag.name)) return false;
    if (
      filteredTasks.some((task) =>
        task["path-refs"].map((obj) => obj.id).includes(tag.id),
      )
    )
      return true;
  });

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
      }

      .qquery-tag-btn {
         border: 1px solid var(--ls-border-color);
         white-space: initial;
         padding: 2px 8px;
         border-radius: 16px;
         cursor: pointer;
      }

      .qquery-tag-selected {
        background-color: #d3d3d3;
      }

      .qquery-tag-btn:hover {
        background-color: #d3d3d3;
      }
      `);

  ///////////////////////////////// RENDER /////////////////////////////////

  function renderMyComponent({
    slot,
    uuid,
    selectedTags,
    remainingTags,
    filteredTasks,
  }) {
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
        data-on-click="fooFunction"
        data-slot-id="${slot}"
        data-block-uuid="${uuid}"
        data-tag-name="${tag.name}"
        class="qquery-tag-btn ${isSelected ? "qquery-tag-selected" : ""}"
      >
        ${tag.name}
      </button>
    `;
  }

  ///////////////////////////////// EVENT HANDLERS /////////////////////////////////

  logseq.provideModel({
    async fooFunction(event) {
      console.log(event);
      const slot = event.dataset.slotId;
      const uuid = event.dataset.blockUuid;
      const tagName = event.dataset.tagName;
      console.log(`${tagName} pressed on ${uuid}`);

      const selectedTagNames = await parseRendererQuery(blockUuid);
      const { selectedTags, remainingTags, filteredTasks } =
        await getTagsAndTasks(selectedTagNames);

      // Do something with the block...
      // await logseq.Editor.updateBlock(blockUuid, newContent);

      //const embeddedTasks = filteredTasks.map((task) => {
      //  return { content: `((${task.uuid}))` };
      //});
      //logseq.Editor.insertBatchBlock(uuid, embeddedTasks, {
      //  sibling: false,
      //});

      // Render the component
      renderMyComponent({
        slot,
        uuid,
        selectedTags,
        remainingTags,
        filteredTasks,
      });
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

    return renderMyComponent({
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
