/** ZEP API response types based on the OpenAPI spec */

export interface ZepProject {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  customer_id: number | null;
  department_id: number;
  tasks_count: number;
  status: {
    id: number;
    name: string;
    bookable: boolean;
  };
  default_billability: {
    id: number;
    name: string;
  } | null;
}

export interface ZepTask {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  project_id: number;
  status: string | null;
  billing_type: {
    id: number;
    name: string;
  } | null;
}

export interface ZepActivity {
  id: number;
  name: string;
  default_factor: number;
}

export interface ZepAttendance {
  id: number;
  date: string;
  from: string;
  to: string;
  employee_id: string;
  project_id: number;
  project_task_id: number;
  activity_id: string;
  duration: number;
  billable: boolean;
  note: string | null;
  work_location_id: string | null;
}

export interface CreateAttendanceInput {
  employee_id: string;
  date: string; // YYYY-MM-DD
  from: string; // HH:mm:ss
  to: string; // HH:mm:ss
  project_id: number;
  project_task_id: number;
  activity_id: string;
  billable?: boolean;
  duration?: number;
  note?: string;
  color?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

/** Flat project+task structure for the cache and skill consumption */
export interface ProjectTaskEntry {
  projectId: number;
  projectName: string;
  taskId: number;
  taskName: string;
  taskPath: string; // "ProjectName -> TaskName" for display
  billable: boolean;
}
