import content from "../content/classic-games.json";
import type { PublicGame, PublishedGame } from "./types";

export const classicGames = content as (PublicGame & Omit<PublishedGame, "playCount">)[];
export const classicListings = classicGames.map(({ html: _html, iconSvg: _icon, ...listing }) => listing);
