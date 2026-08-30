@echo off
setlocal

if "%PCC_AGENT_PI_RUNTIME_HOST%"=="" (
  echo PccAgent bundled Pi runtime is not configured. 1>&2
  exit /b 78
)
if "%PCC_AGENT_PI_ENTRY%"=="" (
  echo PccAgent bundled Pi runtime is not configured. 1>&2
  exit /b 78
)

set "ELECTRON_RUN_AS_NODE=1"
if not "%PCC_AGENT_PI_MCP_EXTENSION%"=="" (
  if "%PCC_AGENT_PI_MCP_CONFIG%"=="" (
    echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
    exit /b 78
  )
  if "%PCC_AGENT_PI_MCP_ADAPTER%"=="" (
    echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
    exit /b 78
  )
  if not "%PCC_AGENT_PI_PROJECT_SKILLS%"=="" (
    if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
      "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --skill "%PCC_AGENT_PI_PROJECT_SKILLS%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
      exit /b %ERRORLEVEL%
    )
    "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --skill "%PCC_AGENT_PI_PROJECT_SKILLS%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
    exit /b %ERRORLEVEL%
  )
  if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
    "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
    exit /b %ERRORLEVEL%
  )
  "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
  exit /b %ERRORLEVEL%
)
if not "%PCC_AGENT_PI_MCP_CONFIG%"=="" (
  echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
  exit /b 78
)
if not "%PCC_AGENT_PI_MCP_ADAPTER%"=="" (
  echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
  exit /b 78
)
if not "%PCC_AGENT_PI_PROJECT_SKILLS%"=="" (
  if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
    "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --skill "%PCC_AGENT_PI_PROJECT_SKILLS%"
    exit /b %ERRORLEVEL%
  )
  "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --skill "%PCC_AGENT_PI_PROJECT_SKILLS%"
  exit /b %ERRORLEVEL%
)
if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
  "%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%"
  exit /b %ERRORLEVEL%
)
"%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_ENTRY%" %*
exit /b %ERRORLEVEL%
