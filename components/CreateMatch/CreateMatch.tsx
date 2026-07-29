"use client";

import { useState } from "react";

export default function CreateMatch() {
  const [currency, setCurrency] = useState("UAH");
  const [mode, setMode] = useState("1v1");
  const [bet, setBet] = useState("50");
  const [customBet, setCustomBet] = useState("");
  const [map, setMap] = useState("Mirage");
  const [server, setServer] = useState("UA #1");

  const currentBet =
    bet === "custom" ? Number(customBet || 0) : Number(bet);

  const isCustomBetValid =
    bet !== "custom" ||
    (currentBet >= 50 && currentBet <= 100000);

  const winnerGets =
    currentBet > 0
      ? (currentBet * 2 * 0.93).toFixed(0)
      : "0";

  const formatMoney = (value: number) =>
    value.toLocaleString("en-US");

  return (
    <section className="flex min-h-screen items-center justify-center bg-black px-6 py-20 text-white">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8">

        <h2 className="mb-2 text-center text-4xl font-bold">
          ⚔️ Создать матч
        </h2>

        <p className="mb-8 text-center text-zinc-400">
          Создай дуэль и жди соперника.
        </p>

        {/* Ставка */}
        <div className="mb-5">
          <label className="mb-2 block text-zinc-300">
            Ставка
          </label>
<div className="mb-5">
  <label className="mb-2 block text-zinc-300">
    Режим
  </label>

  <select
    value={mode}
    onChange={(e) => setMode(e.target.value)}
    className="w-full rounded-xl border border-zinc-700 bg-black p-4"
  >
    <option value="1v1">1 vs 1</option>
    <option value="2v2">2 vs 2</option>
    <option value="5v5">5 vs 5</option>
  </select>
</div>
          <select
            value={bet}
            onChange={(e) => setBet(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-black p-4"
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
            <option value="5000">5000</option>
            <option value="10000">10000</option>
            <option value="custom">Своя сумма</option>
          </select>

          {bet === "custom" && (
            <>
              <input
                type="number"
                value={customBet}
                onChange={(e) => {
                  let value = Number(e.target.value);

                  if (value > 100000) {
                    value = 100000;
                  }

                  setCustomBet(value.toString());
                }}
                placeholder="Введите сумму от 50 до 100000"
                className="mt-4 w-full rounded-xl border border-cyan-500 bg-black p-4"
              />

              {currentBet > 0 && currentBet < 50 && (
                <p className="mt-2 text-center text-red-500">
                  Минимальная ставка 50
                </p>
              )}
            </>
          )}
        </div>

        {/* Валюта */}
        <div className="mb-5">
          <label className="mb-2 block text-zinc-300">
            Валюта
          </label>

          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-black p-4"
          >
            <option value="UAH">🇺🇦 UAH</option>
            <option value="USD">🇺🇸 USD</option>
            <option value="EUR">🇪🇺 EUR</option>
            <option value="GBP">🇬🇧 GBP</option>
            <option value="PLN">🇵🇱 PLN</option>
            <option value="CAD">🇨🇦 CAD</option>
            <option value="AUD">🇦🇺 AUD</option>
            <option value="CHF">🇨🇭 CHF</option>
          </select>
        </div>

        {/* Карта */}
        <div className="mb-5">
          <label className="mb-2 block text-zinc-300">
            Карта
          </label>

          <select
            value={map}
            onChange={(e) => setMap(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-black p-4"
          >
            <option>Mirage</option>
            <option>Dust2</option>
            <option>Ancient</option>
            <option>Train</option>
            <option>Overpass</option>
            <option>Inferno</option>
            <option>Nuke</option>
            <option>Anubis</option>
          </select>
        </div>

        {/* Сервер */}
        <div className="mb-5">
          <label className="mb-2 block text-zinc-300">
            Сервер
          </label>

          <select
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-black p-4"
          >
            <option>UA #1</option>
            <option>EU #1</option>
            <option>EU #2</option>
          </select>
        </div>

        {/* Информация */}
        {currentBet > 0 && (
          <div className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
            <div className="flex justify-between">
              <span className="text-zinc-400">
                Ставка:
              </span>
              <div className="mt-2 flex justify-between">
              <span className="text-zinc-400">
                Режим:
              </span>

              <span>{mode}</span>
            </div>
              <span>
                {formatMoney(currentBet)} {currency}
              </span>
            </div>

            <div className="mt-2 flex justify-between">
              <span className="text-zinc-400">
                Комиссия сайта:
              </span>

              <span>7%</span>
            </div>

            <div className="mt-2 flex justify-between text-lg font-bold text-cyan-400">
              <span>
                Победитель получит:
              </span>

              <span>
                {formatMoney(Number(winnerGets))} {currency}
              </span>
            </div>
          </div>
        )}

        <button
          disabled={!isCustomBetValid}
          className={`w-full rounded-xl py-4 text-lg font-bold transition ${
            isCustomBetValid
              ? "bg-cyan-500 text-black hover:bg-cyan-400"
              : "cursor-not-allowed bg-zinc-700 text-zinc-400"
          }`}
        >
          Создать матч
        </button>

      </div>
    </section>
  );
}