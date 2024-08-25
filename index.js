/** Get all the doable tasks on the page named `lowercaseBlockName`. */
async function getTasksForPage(lowercaseBlockName) {
  let ret;
  try {
    ret = await logseq.DB.datascriptQuery(`
      [:find (pull ?task [:block/name])
       :where
       ; Get current page
       [?page :block/name ${lowercaseBlockName}]
       ; Get tasks on the page
       [?task :block/page ?page]
       [?task :block/marker ?marker]
       [(contains? #{"TODO" "DOING"} ?marker)]
    `);
  } catch (e) {
    console.error(e);
  }

  return (ret || []).flat();
}

/** Like getTasksForPage, but returns only the *tags* associated with those tasks. */
async function getTagsForPage(lowercaseBlockName) {
  let ret;
  try {
    ret = await logseq.DB.datascriptQuery(`
      [:find (pull ?tag [*])
       :where
       ; Get current page
       [?page :block/name "preparing uigc for pldi"]
       ; Get tasks on the page
       [?task :block/page ?page]
       [?task :block/marker ?marker]
       [(contains? #{"TODO" "DOING"} ?marker)]
       ; Get tags of those tasks
       [?task :block/path-refs ?tag]
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

      .qquery-tag-btn:hover {
        background-color: #d3d3d3;
      }
      `);

  ///////////////////////////////// RENDER /////////////////////////////////

  function renderMyComponent({ slot, uuid }) {
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
                <button data-on-click="fooFunction" class="qquery-tag-btn">Tag 1</button>
                <button data-on-click="fooFunction" class="qquery-tag-btn">Tag 2</button>
                <button data-on-click="fooFunction" class="qquery-tag-btn">Tag 3</button>
              </div>
            </div>
          `,
    });
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
    const [type, tags] = payload.arguments;
    const uuid = payload.uuid;
    if (!type === ":qquery") return;

    const page = await logseq.Editor.getCurrentPage();
    console.log(page.name);
    console.log(payload);
    console.log(slot);

    return renderMyComponent({ slot, uuid });
  });
}

// bootstrap
logseq.ready(main).catch(console.error);
