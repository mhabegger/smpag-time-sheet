import axios, { type AxiosInstance } from "axios";
import { getEnv } from "../config/env.js";
import type {
  ZepProject,
  ZepTask,
  ZepActivity,
  ZepAttendance,
  CreateAttendanceInput,
  PaginatedResponse,
} from "./types.js";

export class ZepClient {
  private http: AxiosInstance;

  constructor() {
    const env = getEnv();
    this.http = axios.create({
      baseURL: env.ZEP_BASE_URL,
      headers: {
        Authorization: `Bearer ${env.ZEP_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  /** Fetch all projects, optionally filtered by date range */
  async getProjects(startDate?: string, endDate?: string): Promise<ZepProject[]> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.fetchAllPages<ZepProject>("/projects", params);
  }

  /** Fetch tasks for a specific project */
  async getProjectTasks(projectId: number): Promise<ZepTask[]> {
    return this.fetchAllPages<ZepTask>(`/projects/${projectId}/tasks`);
  }

  /** Fetch activities for a specific project */
  async getProjectActivities(projectId: number): Promise<ZepActivity[]> {
    return this.fetchAllPages<ZepActivity>(`/projects/${projectId}/activities`);
  }

  /** Fetch attendances for a date (optionally filtered by employee) */
  async getAttendances(
    date: string,
    employeeId?: string
  ): Promise<ZepAttendance[]> {
    return this.getAttendancesRange(date, date, employeeId);
  }

  /** Fetch attendances for a date range (optionally filtered by employee) */
  async getAttendancesRange(
    startDate: string,
    endDate: string,
    employeeId?: string
  ): Promise<ZepAttendance[]> {
    const params: Record<string, string> = {
      start_date: startDate,
      end_date: endDate,
    };
    if (employeeId) params.employee_id = employeeId;
    return this.fetchAllPages<ZepAttendance>("/attendances", params);
  }

  /** Create a new attendance entry */
  async createAttendance(
    input: CreateAttendanceInput
  ): Promise<ZepAttendance> {
    const resp = await this.http.post("/attendances", input);
    return resp.data;
  }

  /** Delete an attendance entry */
  async deleteAttendance(id: number): Promise<void> {
    await this.http.delete(`/attendances/${id}`);
  }

  /** Generic paginated fetch - collects all pages */
  private async fetchAllPages<T>(
    url: string,
    params: Record<string, string> = {}
  ): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;

    while (true) {
      const resp = await this.http.get<PaginatedResponse<T>>(url, {
        params: { ...params, limit: 100, page },
      });
      allItems.push(...resp.data.data);

      if (page >= resp.data.meta.last_page) break;
      page++;
    }

    return allItems;
  }
}
