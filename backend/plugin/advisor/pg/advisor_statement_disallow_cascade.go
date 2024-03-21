package pg

// Framework code is generated by the generator.

import (
	"encoding/json"

	pgquery "github.com/pganalyze/pg_query_go/v4"
	"github.com/pkg/errors"

	"github.com/bytebase/bytebase/backend/plugin/advisor"
	"github.com/bytebase/bytebase/backend/plugin/parser/sql/ast"
	storepb "github.com/bytebase/bytebase/proto/generated-go/store"
)

var (
	_ advisor.Advisor = (*StatementDmlDryRunAdvisor)(nil)
	_ ast.Visitor     = (*statementDmlDryRunChecker)(nil)
)

func init() {
	advisor.Register(storepb.Engine_POSTGRES, advisor.PostgreSQLStatementDisallowCascade, &StatementDisallowCascadeAdvisor{})
}

// StatementDisallowCascadeAdvisor is the advisor checking the disallow cascade.
type StatementDisallowCascadeAdvisor struct {
}

// Check checks for DML dry run.
func (*StatementDisallowCascadeAdvisor) Check(ctx advisor.Context, _ string) ([]advisor.Advice, error) {
	stmt := ctx.Statements
	if stmt == "" {
		return []advisor.Advice{
			{
				Status:  advisor.Success,
				Code:    advisor.Ok,
				Title:   "OK",
				Content: "",
			},
		}, nil
	}

	level, err := advisor.NewStatusBySQLReviewRuleLevel(ctx.Rule.Level)
	if err != nil {
		return nil, err
	}

	jsonText, err := pgquery.ParseToJSON(stmt)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to parse statement to JSON")
	}

	var jsonData map[string]any
	if err := json.Unmarshal([]byte(jsonText), &jsonData); err != nil {
		return nil, errors.Wrapf(err, "failed to unmarshal JSON")
	}

	cascadeLocations := cascadeNumRecursive(jsonData, 0)
	cascadePositions := convertLocationsToPositions(stmt, cascadeLocations)

	var adviceList []advisor.Advice
	for _, p := range cascadePositions {
		adviceList = append(adviceList, advisor.Advice{
			Status:  level,
			Title:   string(ctx.Rule.Type),
			Content: "Cascade is disallowed but used in this statement",
			Code:    advisor.StatementDisallowCascade,
			Line:    p.line + 1,
			Column:  p.column + 1,
		})
	}
	if len(adviceList) == 0 {
		adviceList = append(adviceList, advisor.Advice{
			Status:  advisor.Success,
			Code:    advisor.Ok,
			Title:   "OK",
			Content: "",
		})
	}
	return adviceList, nil
}

type pos struct {
	line   int
	column int
}

func convertLocationsToPositions(statement string, locations []int) []pos {
	idx := 0
	line := 0
	columnStart := 0
	var positions []pos
	for i, c := range statement {
		if c == '\n' {
			line++
			columnStart = i + 1
			continue
		}
		if idx < len(locations) && i >= locations[idx] {
			positions = append(positions, pos{line, i - columnStart})
			idx++
		}
	}
	for idx < len(locations) {
		positions = append(positions, pos{line, 0})
		idx++
	}
	return positions
}

func cascadeNumRecursive(jsonData map[string]any, stmtLocation int) []int {
	if l, ok := jsonData["stmt_location"]; ok {
		if l, ok := l.(float64); ok {
			stmtLocation = int(l)
		}
	}

	var cascadeLocations []int

	for _, value := range jsonData {
		switch value := value.(type) {
		case map[string]any:
			cascadeLocations = append(cascadeLocations, cascadeNumRecursive(value, stmtLocation)...)
		case []any:
			for _, v := range value {
				mv, ok := v.(map[string]any)
				if !ok {
					continue
				}
				cascadeLocations = append(cascadeLocations, cascadeNumRecursive(mv, stmtLocation)...)
			}
		}
	}

	if jsonData["behavior"] == "DROP_CASCADE" || jsonData["fk_del_action"] == "c" {
		cascadeLocations = append(cascadeLocations, stmtLocation)
	}

	return cascadeLocations
}
