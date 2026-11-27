export function leadsForDashboard(leads, role, teamId = null) {
  if (role !== "leader") return leads;
  if (!teamId) return leads.filter((lead) => lead.isOwnLead === true);
  return leads.filter((lead) => lead.isOwnLead !== true && lead.ownerId === teamId);
}
