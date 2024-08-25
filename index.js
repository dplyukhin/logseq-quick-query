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

/********* MAIN  *********/

function main() {
  const genRandomStr = () =>
    Math.random()
      .toString(36)
      .replace(/[^a-z]+/g, "")
      .substr(0, 5);

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

  function renderMyComponent({ slot, uuid, selectedTags, remainingTags }) {
    return logseq.provideUI({
      key: getKey(uuid),
      slot,
      reset: true,
      template: `
            <div
            class="qquery"
            data-slot-id="${slot}"
            data-block-uuid="${uuid}" >
              <b>Quick Query</b>
              <div class="qquery-tag-container">
                ${selectedTags.map((tag) => _renderTag(tag, true)).join("")}
                ${remainingTags.map((tag) => _renderTag(tag, false)).join("")}
              </div>
            </div>
          `,
    });
  }

  function _renderTag(tag, isSelected) {
    return `
      <button data-on-click="fooFunction" class="qquery-tag-btn ${isSelected ? "qquery-tag-selected" : ""}">
        ${tag["name"]}
      </button>
    `;
  }

  ///////////////////////////////// EVENT HANDLERS /////////////////////////////////

  logseq.provideModel({
    async fooFunction(event) {
      console.log(event);
      const { slotId, blockUuid } = event.dataset;
      console.log(`Button pressed on ${blockUuid}`);

      const block = await logseq.Editor.getBlock(blockUuid);
      const newContent = block?.content;
      if (!newContent) return;
      // Do something with the block...
      await logseq.Editor.updateBlock(blockUuid, newContent);

      // Render the component
      renderMyComponent({ slot: slotId, uuid: blockUuid });
    },
  });

  // Implement the renderer for qquery
  logseq.App.onMacroRendererSlotted(async ({ slot, payload }) => {
    // The arguments of {{renderer foo bar, baz beans, qux}} are ["foo bar", "baz beans", "qux"].
    // For us, the first argument is :qquery.
    // The rest of the arguments are the tags that the user has selected, in all-lowercase.
    const type = payload.arguments[0];
    const selectedTagNames = payload.arguments.slice(1);
    const uuid = payload.uuid;
    if (!type === ":qquery") return;

    const page = await logseq.Editor.getCurrentPage();
    const tasks = await getTasksForPage(page.name);
    const tags = await getTagsForPage(page.name);
    console.log("tasks", tasks);
    console.log("tags", tags);
    console.log(payload);
    console.log(slot);

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

    console.log("selectedTags", selectedTags);
    console.log("remainingTags", remainingTags);
    console.log("filteredTasks", filteredTasks);

    return renderMyComponent({ slot, uuid, selectedTags, remainingTags });
  });
}

// bootstrap
logseq.ready(main).catch(console.error);
