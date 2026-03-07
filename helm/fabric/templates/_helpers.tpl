{{/*
Common labels
*/}}
{{- define "fabric.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "fabric.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Full name
*/}}
{{- define "fabric.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL connection string
*/}}
{{- define "fabric.databaseUrl" -}}
postgresql://{{ .Values.postgresql.username }}:{{ .Values.postgresql.password }}@{{ include "fabric.fullname" . }}-postgresql:5432/{{ .Values.postgresql.database }}
{{- end }}
