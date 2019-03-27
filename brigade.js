const { events } = require("@azure/brigadier");

events.on("exec", (event, project) => {
  console.log("Hello Brigade!");
  console.log(event);
  console.log(project);
});
