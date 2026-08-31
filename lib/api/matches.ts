export type CreateMatchData={mode:"SOLO_1V1";mapName:string;betAmount:number};
export async function getMatches(query=""){const response=await fetch(`/api/matches${query}`,{cache:"no-store"});if(!response.ok)throw new Error("Не удалось получить матчи");return response.json()}
export async function createMatch(data:CreateMatchData){const response=await fetch("/api/matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error??"Ошибка создания матча");return result}
