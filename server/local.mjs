import app from "./index.mjs";
const port = Number(process.env.PORT ?? 8787);

 app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
    console.log(`Interview evaluator listening on http://127.0.0.1:${port}`);
  });