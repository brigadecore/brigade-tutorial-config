import { events } from "@azure/brigadier";

events.on("exec", e => {
  console.log(e);
});
