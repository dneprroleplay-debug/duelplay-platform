export type CreateMatchData = {
  mode: string;
  mapName: string;
  betAmount: number;
  commission: number;
  lobbyCode?: string | null;
};

export async function getMatches() {
  const response = await fetch("/api/matches", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Не удалось получить матчи");
  }

  return response.json();
}

export async function createMatch(data: CreateMatchData) {
  const response = await fetch("/api/matches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error ?? "Ошибка создания матча");
  }

  return response.json();
}