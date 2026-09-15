import { loadPolicyDocuments } from "./policy-content.mjs";

loadPolicyDocuments().then(({ documents }) => {
  const chunks = documents.reduce((total, document) => total + document.chunks.length, 0);
  console.log(`Validated ${documents.length} policy documents and ${chunks} deterministic chunks.`);
}).catch((error) => {
  console.error(error instanceof Error ? error.message : "Policy validation failed.");
  process.exitCode = 1;
});
