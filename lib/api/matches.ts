export type CreateMatchData={mode:"SOLO_1V1";mapName:string;betAmount:number};

async function readResponse(response:Response){
  const text=await response.text();
  if(!text)return {};
  try{return JSON.parse(text)}catch{return {}}
}

export async function getMatches(query=""){
  const response=await fetch(`/api/matches${query}`,{cache:"no-store"});
  const result=await readResponse(response);
  if(!response.ok)throw new Error(result.errorCode??"MATCHES_LOAD_ERROR");
  return result;
}

export async function createMatch(data:CreateMatchData){
  const response=await fetch("/api/matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const result=await readResponse(response);
  if(!response.ok){
    if(response.status===401)throw new Error("AUTH_REQUIRED");
    throw new Error(result.errorCode??"MATCH_CREATE_ERROR");
  }
  return result;
}
