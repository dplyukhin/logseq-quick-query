function main() {
  logseq.Editor.registerSlashCommand("quick query", async () => {
    const { content, uuid } = await logseq.Editor.getCurrentBlock();

    logseq.App.showMsg(`
        [:div.p-2
          [:h1 "#${uuid}"]
          [:h2.text-xl "${content}"]]
      `);
  });
}

// bootstrap
logseq.ready(main).catch(console.error);
