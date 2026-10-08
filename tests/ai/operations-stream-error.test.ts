import {operationsStreamErrorMessage} from "@/app/_ai/operations-stream-error";
const trace="00000000-0000-4000-8000-000000000001";
it.each([
  [Object.assign(new Error("PRIVATE HOST KEY"),{cause:Object.assign(new Error("PRIVATE BODY"),{code:"UND_ERR_CONNECT_TIMEOUT"})}),"could not be reached"],
  [Object.assign(new Error("PRIVATE KEY"),{name:"TimeoutError"}),"took too long"],
  [Object.assign(new Error("PRIVATE KEY"),{statusCode:429}),"rate limited"],
  [Object.assign(new Error("PRIVATE KEY"),{statusCode:401}),"contact an administrator"],
  [new Error("PRIVATE BODY"),"could not complete"],
])("classifies the safe failure while excluding private provider details",(error,text)=>{
 const message=operationsStreamErrorMessage(error,trace);expect(message).toContain(text);expect(message).toContain(trace);expect(message).not.toMatch(/PRIVATE|HOST|KEY|BODY/);
});
