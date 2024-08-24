function main() {
  const genRandomStr = () =>
    Math.random()
      .toString(36)
      .replace(/[^a-z]+/g, "")
      .substr(0, 5);

  const getKey = (uuid) => `qquery_${uuid}`;

  // Register a slash command
  logseq.Editor.registerSlashCommand("Quick query", async () => {
    const { content, uuid } = await logseq.Editor.getCurrentBlock();
    await logseq.Editor.insertAtEditingCursor(`{{renderer :qquery}} `);
  });

  function renderMyComponent({ slot, uuid }) {
    return logseq.provideUI({
      key: getKey(uuid),
      slot,
      reset: true,
      template: `
            <div
            class="quick-query"
            data-slot-id="${slot}"
            data-block-uuid="${uuid}">
              <b>Quick Query</b>
              <button data-on-click="fooFunction" class="qquery-tag-btn">Tag 1</button>
            </div>
          `,
    });
  }

  logseq.provideStyle(`
    .qquery-tag-btn {
       border: 1px solid var(--ls-border-color);
       white-space: initial;
       padding: 2px 8px;
       border-radius: 16px;
       user-select: none;
       cursor: pointer;
       display: flex;
       align-content: center;
    }

    .qquery-tag-btn:hover {
      background-color: #d3d3d3;
    }
    `);

  logseq.provideModel({
    async fooFunction(event) {
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
  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    // The arguments of {{renderer foo bar, baz beans, qux}} are ["foo bar", "baz beans", "qux"].
    // For us, the first argument is :qquery.
    const [type, other, unused, args] = payload.arguments;
    const uuid = payload.uuid;
    if (!type === ":qquery") return;

    console.log(payload);
    console.log(slot);

    return renderMyComponent({ slot, uuid });
  });
}

// bootstrap
logseq.ready(main).catch(console.error);
