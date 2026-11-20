# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: מניות · Apple (יומי) · AAPL · 1d
# Version: v1.4 · Strategy family: rsi_reversion
# Backtest: return 10.86% · PF 7.36 · DD 2.1% · trades 11
# OOS: 3.24% · Sharpe 2
# Params: {"period":10,"oversold":36,"overbought":84,"atrStop":1.3,"rr":1.6}
# Target platform: Freqtrade
# Generated: 2026-11-20T23:55:04.796Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_aapl --config user_data/config.json
#   freqtrade trade --strategy Altadesk_aapl --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_aapl(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1d'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.016
    minimal_roi = {"0": 1.44, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=10)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 36)
        & (dataframe['rsi'].shift(1) > 36)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 84)
        & (dataframe['rsi'].shift(1) < 84)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 36)
        & (dataframe['rsi'].shift(1) > 36)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 84)
        & (dataframe['rsi'].shift(1) < 84)
            ),
            'exit_long',
        ] = 1
        return dataframe
