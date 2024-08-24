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
            data-block-uuid="${uuid}"
            data-on-click="fooFunction">
            <b>Quick Query</b>
            </div>
          `,
    });
  }

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
