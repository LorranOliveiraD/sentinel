// Mock Data para Demonstração do Sentinel V3
const MOCK_DATA = {
    totalPRs: 247,
    avgRisk: 34,
    blockRate: 11.2,
    
    prActivity: [
        { id: '#142', author: '@lorranzinho', action: 'pass', score: 12, issue: 'Nenhuma (Clean PR)' },
        { id: '#141', author: '@dev_junior', action: 'block', score: 100, issue: 'AWS Access Key Leak (secrets.ts)' },
        { id: '#140', author: '@tech_lead', action: 'warn', score: 65, issue: 'Baixa Cobertura de Testes (tests.ts)' },
        { id: '#139', author: '@lorranzinho', action: 'pass', score: 0, issue: 'Nenhuma (Rubber Stamp)' },
        { id: '#138', author: '@frontend_dev', action: 'block', score: 95, issue: 'CVE Crítico (cve.ts)' },
        { id: '#137', author: '@data_eng', action: 'warn', score: 45, issue: 'PR Excede Limite de Linhas (pr-size.ts)' },
    ]
};

// Inicializa a UI do Dashboard
document.addEventListener('DOMContentLoaded', () => {
    
    // Anima a contagem numérica da visão geral (efeito contator)
    animateValue('total-prs', 0, MOCK_DATA.totalPRs, 1000);
    animateValue('avg-risk', 0, MOCK_DATA.avgRisk, 1000, '/100');
    animateValue('block-rate', 0, MOCK_DATA.blockRate, 1000, '%');

    // Popula a tabela com os PRs mockados
    const tableBody = document.getElementById('pr-list');
    
    MOCK_DATA.prActivity.forEach((pr, index) => {
        const row = document.createElement('tr');
        
        // Staggered animation delay
        row.style.animationDelay = `${index * 0.15}s`;
        row.className = 'fade-in-row';

        row.innerHTML = `
            <td style="font-weight: 600; color: var(--neon-blue);">${pr.id}</td>
            <td>${pr.author}</td>
            <td><span class="badge ${pr.action}">${pr.action}</span></td>
            <td class="score-indicator">${pr.score}</td>
            <td style="color: var(--text-secondary);">${pr.issue}</td>
        `;
        
        tableBody.appendChild(row);
    });

    // Popula a tabela completa (Aba Pull Requests)
    const fullTableBody = document.getElementById('full-pr-list');
    if (fullTableBody) {
        MOCK_DATA.prActivity.forEach((pr) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-weight: 600; color: var(--neon-blue);">${pr.id}</td>
                <td>${pr.author}</td>
                <td><span class="badge ${pr.action}">${pr.action}</span></td>
                <td class="score-indicator">${pr.score}</td>
                <td style="color: var(--text-secondary); font-size: 0.85rem;">O Sentinel identificou: ${pr.issue}. O Claude recomendou ação imediata.</td>
            `;
            fullTableBody.appendChild(row);
        });
    }

    // Lógica de Navegação nas Abas
    const menuItems = document.querySelectorAll('.menu-item');
    const tabContents = document.querySelectorAll('.tab-content');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all
            menuItems.forEach(i => i.classList.remove('active'));
            tabContents.forEach(t => t.style.display = 'none');
            
            // Add active class to clicked
            item.classList.add('active');
            
            // Show target content
            const targetId = item.getAttribute('data-target');
            if(targetId) {
                const targetEl = document.getElementById(targetId);
                if(targetEl) {
                    targetEl.style.display = 'block';
                    // Re-trigger animations se voltar pra visão geral
                    if (targetId === 'visao-geral') {
                        document.getElementById('total-prs').innerText = '0';
                        document.getElementById('avg-risk').innerText = '0/100';
                        document.getElementById('block-rate').innerText = '0%';
                        animateValue('total-prs', 0, MOCK_DATA.totalPRs, 800);
                        animateValue('avg-risk', 0, MOCK_DATA.avgRisk, 800, '/100');
                        animateValue('block-rate', 0, MOCK_DATA.blockRate, 800, '%');
                    }
                }
            }
        });
    });
});

// Função utilitária para animar contadores na tela
function animateValue(id, start, end, duration, suffix = '') {
    const obj = document.getElementById(id);
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        
        // easeOutQuart interpolation
        const easeProgress = 1 - Math.pow(1 - progress, 4);
        const currentVal = (progress * (end - start)).toFixed(end % 1 !== 0 ? 1 : 0);
        
        obj.innerHTML = currentVal + suffix;
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end + suffix;
        }
    };
    window.requestAnimationFrame(step);
}
