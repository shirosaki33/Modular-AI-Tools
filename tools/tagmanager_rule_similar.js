/* =========================================================================
   2. SIMILAR TAGS - TAG MANAGER
   ---------------------------------------------------------------------
   Similar/Redundant tags logic and Yellow UI Section.
========================================================================= */

(function () {
    const FACTORY_SIMILAR = [
        ['happy', 'smile', 'smiling', 'grin', 'laughing'],
        ['sad', 'crying', 'tears', 'frowning'],
        ['angry', 'annoyed', 'scowl', 'glaring'],
        ['expressionless', 'blank stare', 'emotionless'],
        ['shocked', 'wide-eyed'],
        ['closed mouth', 'parted lips', 'open mouth'],
        ['crouching', 'squatting'],
        ['short hair', 'medium hair', 'long hair', 'very long hair', 'absurdly long hair'],
        ['blonde hair', 'red hair', 'brown hair', 'black hair', 'blue hair', 'purple hair', 'pink hair', 'green hair', 'white hair', 'silver hair', 'grey hair'],
        ['flat chest', 'small breasts', 'medium breasts', 'large breasts', 'huge breasts', 'gigantic breasts'],
        ['nude', 'completely nude', 'topless', 'bottomless', 'naked'],
        ['portrait', 'close-up', 'cowboy shot', 'upper body', 'full body'],
        ['from above', 'from below', 'from behind', 'from side'],
        ['dutch angle', 'tilted frame']
    ];

    FACTORY_SIMILAR.forEach((tags, i) => window.RulesDB.factoryRules.push({ id: 'def_sim_'+i, category: 'similar', isDefault: true, tags }));

    window.RulesUI.registerSection(2, async (rows) => {
        const isEnabled = await window.getSetting('rm_enable_yellow', true);
        return window.RulesUI.renderGenericCategorySection('similar', rows, isEnabled, 'rm_enable_yellow');
    });

    window.IssueCounters.types.push('similar');
})();
