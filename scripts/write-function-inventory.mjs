import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
const production=process.argv.includes("--prod");
const spec=JSON.parse(execFileSync("npx",["convex","function-spec",...(production?["--prod"]:[])],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
const functions=spec.functions.filter(f=>f.identifier&&!f.identifier.startsWith("_"));
const rows=functions.map(f=>{
 const name=f.identifier.replace(/\.js:/,":"),module=name.split(":")[0],args=f.args?.type==="object"?Object.keys(f.args.value??{}).join(", "):"provider-defined";
 return `| \`${name}\` | ${f.visibility?.kind??"HTTP"} ${f.functionType} | ${args||"—"} | [source](../convex/${module}.ts) |`;
});
writeFileSync(new URL("../docs/backend-function-inventory.md",import.meta.url),`# Backend function inventory\n\nGenerated from the ${production?"production":"development"} deployment's actual function metadata. ${functions.length} functions. Argument names below are an index; exact validators and return contracts live in the linked source and generated TypeScript API. Application public endpoints derive identity from Convex Auth and check membership. Authentication endpoints intentionally allow sign-in. Internal endpoints require operator CLI access or a backend caller.\n\n| Function | Visibility/type | Arguments | Source |\n|---|---|---|---|\n${rows.join("\n")}\n`);
console.log(JSON.stringify({written:true,deployment:production?"production":"development",functions:functions.length}));
