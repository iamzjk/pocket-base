import content from "../content/classic-games.json";
import type { PublicGame, PublishedGame } from "./types";

export const classicGames = content as (PublicGame & PublishedGame)[];
export const classicListings: PublishedGame[] = classicGames.map(({ html: _html, iconSvg: _icon, ...listing }) => listing);
