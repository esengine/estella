// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   esengine/zones — a world split over several server processes, one
 *          zone each (a map, a line of a map, an instance). A directory of the
 *          zones that are up, leases that keep each player in one zone at a
 *          time, one-use tickets between zones, and ZoneHost, which runs one
 *          zone's side of it over a replication server and player records.
 *          Everything lives in a PersistStore all zones share.
 */
export { ZoneDirectory, type ZoneInfo, type ZoneDirectoryOptions } from './directory';
export { PlayerLeases, LeaseHeld, type PlayerLease, type PlayerLeasesOptions } from './leases';
export { TransferTickets, TicketRefused, type TransferTicket, type TransferTicketsOptions } from './tickets';
export { ZoneHost, type ZoneHostOptions } from './zoneHost';
