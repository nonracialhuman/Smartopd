import type { BedStatus, BedType, DoctorStatus, Priority, StaffRole, TokenStatus, VacancyBand } from "./domain";

export interface DepartmentDTO { id: string; name: string; code: string; avgConsultMinutes: number }

export interface DoctorDTO { id: string; name: string; room: string; departmentId: string; status: DoctorStatus; currentTokenId: string | null }

export interface PublicQueueDTO {
  seq: number;
  department: DepartmentDTO;
  nowServing: { label: string; room: string; status: TokenStatus }[];
  waiting: { label: string; priority: Priority; position: number; etaMinutes: number | null }[];
  waitingCount: number;
  activeDoctors: number;
  avgConsultMinutes: number;
  nextEtaMinutes: number | null;
}

export interface StaffTokenRow {
  id: string; label: string; status: TokenStatus; priority: Priority;
  patientName: string; age: number | null; checkedInAt: string; calledAt: string | null; startedAt: string | null;
  completedAt: string | null; doctorId: string | null; room: string | null;
  position: number | null; ahead: number | null; etaMinutes: number | null; estimatedCallTime: string | null;
}

export interface StaffQueueDTO {
  seq: number;
  department: DepartmentDTO;
  active: StaffTokenRow[];
  waiting: StaffTokenRow[];
  recent: StaffTokenRow[];
  doctors: DoctorDTO[];
  avgConsultMinutes: number;
  activeDoctors: number;
}

export interface TokenViewDTO {
  seq: number;
  id: string;
  label: string;
  status: TokenStatus;
  priority: Priority;
  department: DepartmentDTO;
  patientFirstName: string;
  position: number | null;
  ahead: number | null;
  etaMinutes: number | null;
  estimatedCallTime: string | null;
  room: string | null;
  doctorName: string | null;
  nowServing: string | null;
  doctorsOnDuty: number;
  missedCount: number;
  checkedInAt: string; calledAt: string | null; startedAt: string | null; completedAt: string | null;
}

export interface TokenCalledEvent { seq: number; tokenId: string; label: string; room: string; doctorName: string }

export interface BedDTO { id: string; wardId: string; bedNumber: string; status: BedStatus; patientName: string | null; version: number; updatedAt: string; updatedBy: string | null }

export interface WardDTO {
  id: string; name: string; type: BedType; totalBeds: number;
  vacant: number; occupied: number; cleaning: number; reserved: number;
  verifiedAt: string | null; verifiedBy: string | null; lastChangeAt: string | null;
}

export interface BedAggregateItem { type: BedType; vacant: number; total: number; band: VacancyBand; freshAt: string | null; stale: boolean }

export interface BedBoardDTO { seq: number; aggregates: BedAggregateItem[]; wards: WardDTO[]; serverTime: string }

export interface BedUpdatedEvent { seq: number; bed: BedDTO }

export interface AdminOverviewDTO {
  seq: number;
  departments: { department: DepartmentDTO; waiting: number; active: number; longestWaitMinutes: number; avgConsultMinutes: number; doctorsOnDuty: number }[];
  doctors: (DoctorDTO & { departmentName: string })[];
  simulator: { enabled: boolean };
  serverTime: string;
}

export interface SessionUser { id: string; email: string; name: string; role: StaffRole; departmentId: string | null; doctorId: string | null }
